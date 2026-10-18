import { clear, createStore, del, get, getMany, set, delMany, keys } from 'idb-keyval';
import { assembleText, splitText, type V2Parts } from '../store/formatV2';
import { disk, diskAvailable, type DiskWriteResult, type KeepVersion } from './disk';
import { guard, setProblem, sha256Hex, type Pending } from './saveGuard';
import { holdsWriterLock } from './writerLock';
import type { StateJson } from '../store/persistJson';

/**
 * IndexedDB stores:
 *  - `state`: the persisted app state (one JSON document)
 *  - `blobs`: media bytes for assets and designer raster layers
 *  - `cache`: provider catalogs and model schemas (with timestamps)
 * State and blobs are mirrored to disk by the local server when it runs (see ./disk.ts); the cache is not.
 */
const stateStore = createStore('ogs-state', 'kv');
const blobStore = createStore('ogs-blobs', 'kv');
const cacheStore = createStore('ogs-cache', 'kv');

// The saved state is one JSON document; a leading `savedAt` stamp tells which copy (browser or disk) is newer.
const savedAt = (value: string | null | undefined) => Number(/^\{"savedAt":(\d+)/.exec(value ?? '')?.[1] ?? 0);

/** The same state in two copies: the same globals, order and session texts (the savedAt stamp is not part of it). */
function sameContent(a: V2Parts, b: V2Parts): boolean {
  return a.globals === b.globals && a.order.length === b.order.length && a.order.every((id, i) => b.order[i] === id && a.sessions.get(id) === b.sessions.get(id));
}

// Format 2 (ADR 0014): one record per session in its own database. The format-1 keys (`ogs-app` and `ogs-app:b`) are
// never written or deleted; the first load that finds only format 1 copies it whole to `ogs-app:format1-backup-<savedAt>`.
const v2Store = createStore('ogs-store-v2', 'kv');
// The session texts this tab last committed to v2Store: a commit writes only the ones that differ.
const committed = new Map<string, string>();

async function readV2(): Promise<V2Parts | null> {
  const manifest = await get<{ savedAt: number; version: number; order: string[] }>('manifest', v2Store);
  if (!manifest) return null;
  const globals = (await get<string>('globals', v2Store)) ?? '{}';
  const texts = await getMany(manifest.order.map((id) => `session:${id}`), v2Store);
  const sessions = new Map<string, string>();
  manifest.order.forEach((id, i) => {
    if (typeof texts[i] === 'string') sessions.set(id, texts[i] as string);
  });
  if (sessions.size !== manifest.order.length) return null; // a missing session: the manifest is not complete
  return { savedAt: manifest.savedAt, version: manifest.version, globals, order: manifest.order, sessions };
}

/** One readwrite transaction on the format-2 database; resolves when it completes. */
function txV2(apply: (store: IDBObjectStore) => void): Promise<void> {
  return v2Store('readwrite', (store) => {
    apply(store);
    const tx = store.transaction;
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB commit aborted'));
    });
  });
}
/** The unsent-work record (`pending`, see saveGuard.ts) as one write; undefined removes it. */
const putPending = (store: IDBObjectStore, p: Pending | undefined) => (p ? store.put(p, 'pending') : store.delete('pending'));

/**
 * Publishes a format-2 state atomically: changed and removed sessions, globals and manifest in one transaction.
 * `pend` (the unsent-work record) goes in the SAME transaction: a copy on disk-less storage is never without its record.
 */
async function commitV2(p: V2Parts, pend?: Pending | null): Promise<void> {
  const changed: Array<[string, string]> = [];
  for (const [id, text] of p.sessions) if (committed.get(id) !== text) changed.push([`session:${id}`, text]);
  const removed = [...committed.keys()].filter((id) => !p.sessions.has(id)).map((id) => `session:${id}`);
  // One readwrite transaction: a reader sees the old revision or the new one, never a manifest without its sessions.
  await txV2((store) => {
    for (const [key, text] of changed) store.put(text, key);
    for (const key of removed) store.delete(key);
    store.put(p.globals, 'globals');
    store.put({ savedAt: p.savedAt, version: p.version, order: p.order }, 'manifest');
    if (pend !== undefined) putPending(store, pend ?? undefined);
  });
  committed.clear();
  for (const [id, text] of p.sessions) committed.set(id, text);
}

/** The disk confirmed (`ok`) or has no server (`browser-only`) revision `rev`, saved at `at`: pending and acked move on. */
async function settle(rev: number, at: number, parts: V2Parts, ok: boolean): Promise<void> {
  if (ok && rev > guard.ackedRev) { guard.acked = new Map(parts.sessions); guard.ackedRev = rev; guard.diskAt = at; }
  const p = guard.pending;
  if (!p) return;
  // A newer local revision written while this one was in flight stays pending, rebased on what the disk now holds.
  const next = p.rev <= rev ? undefined : ok ? { rev: p.rev, baseAt: at } : p;
  if (next === p) return;
  guard.pending = next;
  await txV2((store) => putPending(store, next)).catch(() => undefined);
}

/** Format 1 as the browser had it: the text of `ogs-app` or its newer copy `ogs-app:b`, and the disk copy. */
async function readLegacy(key: string): Promise<string | undefined> {
  const [legacy, current] = await Promise.all([get<string>(key, stateStore), get<Blob | string>(`${key}:b`, stateStore)]);
  const text = current instanceof Blob ? await current.text() : current;
  return savedAt(text) >= savedAt(legacy) ? text ?? legacy : legacy;
}

/** Copies format 1 whole before its first format-2 write (once; the original keys stay as they are). */
async function backupLegacy(key: string, legacy: string | undefined): Promise<void> {
  if (!legacy) return;
  const backupKey = `${key}:format1-backup-${savedAt(legacy)}`;
  if (!(await get(backupKey, stateStore))) await set(backupKey, legacy, stateStore);
}

/** Every IndexedDB database the app owns (format 1 state, media, caches, format 2 state). */
export const ALL_DB_NAMES = ['ogs-state', 'ogs-blobs', 'ogs-cache', 'ogs-store-v2'] as const;

/**
 * Deletes databases and waits for each request. A blocked delete (another connection is still open, e.g. this page's own
 * idb-keyval handle) stays queued in the browser and runs when the connection closes, before the reloaded page can open it.
 */
export function deleteDatabases(names: readonly string[]): Promise<void> {
  if (!holdsWriterLock()) return Promise.resolve(); // only the tab that holds the writer lock changes storage (writerLock.ts)
  return Promise.all(names.map((name) => new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // best effort: a failed delete must not stop the others or the reload
    req.onblocked = () => resolve();
  }))).then(() => undefined);
}

/**
 * Wipes every local database. The stores are emptied first (deterministic: idb-keyval keeps its connection open, so the
 * delete itself may stay blocked until the page reloads), then the databases are deleted.
 */
export async function wipeLocalDatabases(): Promise<void> {
  if (!holdsWriterLock()) return;
  await Promise.all([stateStore, blobStore, cacheStore, v2Store].map((store) => clear(store).catch(() => undefined)));
  await deleteDatabases(ALL_DB_NAMES);
}

/** Sends the local copy built on disk state `base` (the preserved one, never a new base); a refusal keeps the local copy active. */
async function resend(key: string, local: string, base: number, parts: V2Parts | null): Promise<void> {
  const result = await disk.putState(local, base);
  if (result === 'ok') {
    if (parts) { guard.acked = new Map(parts.sessions); guard.diskAt = savedAt(local); }
    guard.pending = undefined;
    await txV2((store) => putPending(store, undefined)).catch(() => undefined);
  } else if (result === 'conflict') await hold(key, local);
  else if (result === 'rejected') setProblem({ reason: 'possible-loss', ...disk.rejection() });
}
/** The disk moved on since the unsent work began: keep both. Nothing is sent and nothing is replaced until the user decides. */
async function hold(key: string, local: string): Promise<void> {
  guard.held = true;
  await set(`${key}:conflict-${Date.now()}`, local, stateStore);
  setProblem({ reason: 'conflict' });
}


// Disk sends of the state, one at a time: each computes its diff and settles its ack before the next one starts.
let sendChain: Promise<void> = Promise.resolve();

async function sendCommit(key: string, rev: number, at: number, parts: V2Parts, keep: boolean): Promise<DiskWriteResult> {
  // The lock is asked again at send time: a tab that lost it while this send waited sends nothing (pending stays, so
  // the next holder resends it from IndexedDB).
  if (!holdsWriterLock()) return 'browser-only';
  if (guard.held) return 'conflict';
  const differs = (id: string) => guard.acked.get(id) !== parts.sessions.get(id);
  const changed = parts.order.filter(differs).map((id) => [id, parts.sessions.get(id)!] as [string, string]);
  const all = parts.order.map((id) => [id, parts.sessions.get(id)!] as [string, string]);
  const approval = keep ? await approvalFor(parts) : undefined;
  const result = await disk.setCommit({ savedAt: at, version: parts.version, globals: parts.globals, order: parts.order, changed, all, keep: approval });
  if (result === 'ok') {
    await settle(rev, at, parts, true);
    setProblem(null);
  } else if (result === 'browser-only' && holdsWriterLock()) await settle(rev, at, parts, false);
  else if (result === 'rejected') setProblem({ reason: 'possible-loss', ...disk.rejection() });
  else if (result === 'conflict') {
    // The first refusal keeps a dated copy of this tab's state; later saves of the same episode do not pile up copies.
    if (guard.problem?.reason !== 'conflict') {
      await set(`${key}:conflict-${at}`, assembleText(parts), stateStore);
      setProblem({ reason: 'conflict' });
    }
  }
  return result;
}

/**
 * "Keep this version": approves EVERY loss the server listed for this exact candidate (each shrinking session by the
 * hashes of the disk text and of the text sent, and a large removal of sessions by the hashes of both orders).
 */
async function approvalFor(parts: V2Parts): Promise<KeepVersion | undefined> {
  const p = guard.problem;
  if (p?.reason !== 'possible-loss') return undefined;
  const losses = p.losses ?? (p.sessionId ? [{ sessionId: p.sessionId, diskHash: p.diskHash }] : []);
  const sessions = [];
  for (const l of losses) {
    const text = parts.sessions.get(l.sessionId);
    if (text == null) continue;
    sessions.push({ sessionId: l.sessionId, diskHash: l.diskHash ?? await sha256Hex(guard.acked.get(l.sessionId) ?? ''), candidateHash: await sha256Hex(text) });
  }
  const total = p.total ? { diskOrderHash: p.total.diskOrderHash, candidateOrderHash: await sha256Hex(JSON.stringify(parts.order)) } : undefined;
  return sessions.length || total ? { sessions, ...(total ? { total } : {}) } : undefined;
}

export const stateDb = {
  /**
   * The state text: format 2 when it exists, else format 1, which is migrated on this load. A disk copy that is newer
   * is adopted (it becomes format 2 too); a newer local copy is pushed to the disk.
   */
  async get(key: string): Promise<string | undefined> {
    if (!holdsWriterLock()) return undefined; // a tab without the lock loads nothing and adopts or pushes nothing
    // Each load (the first one, or taking the lock back) starts clean: nothing of an earlier holding period is kept.
    disk.reset();
    Object.assign(guard, { acked: new Map(), ackedRev: 0, held: false, discarding: false });
    setProblem(null);
    committed.clear();
    const v2 = await readV2();
    const legacy = v2 ? undefined : await readLegacy(key);
    const onDisk = await disk.getState();
    if (v2) for (const [id, text] of v2.sessions) committed.set(id, text);
    const local = v2 ? assembleText(v2) : legacy;
    const pending = await get<Pending>('pending', v2Store).catch(() => undefined);
    guard.pending = pending;
    guard.rev = pending?.rev ?? 0;
    guard.diskAt = savedAt(onDisk);
    const diskParts = (() => { try { return onDisk ? splitText(onDisk) : null; } catch { return null; } })();
    if (diskParts) guard.acked = new Map(diskParts.sessions);
    const localParts = (() => { try { return local ? splitText(local) : null; } catch { return null; } })();
    // The disk is newer and this tab has nothing unsent: adopt it (it becomes format 2 too). Never with unsent work.
    if (onDisk && savedAt(onDisk) > savedAt(local) && !pending) {
      await backupLegacy(key, legacy);
      await commitV2(splitText(onDisk));
      return onDisk;
    }
    if (pending && local && onDisk) {
      if (localParts && diskParts && sameContent(localParts, diskParts)) {
        // The disk already holds this work (the acknowledgement was lost): nothing to resend.
        guard.pending = undefined;
        await txV2((store) => putPending(store, undefined)).catch(() => undefined);
      } else if (savedAt(onDisk) === pending.baseAt) await resend(key, local, pending.baseAt, localParts);
      else await hold(key, local);
    } else if (local && onDisk && savedAt(local) > savedAt(onDisk)) {
      await resend(key, local, savedAt(onDisk), localParts);
    } else if (local && !onDisk) await disk.setState(local);
    if (legacy) {
      await backupLegacy(key, legacy);
      await commitV2(splitText(legacy));
    }
    return local ?? undefined;
  },
  /**
   * Saves a state: format 2 locally FIRST and always (even when the disk is stale or refusing), then the disk commit of
   * what the disk has not confirmed. A refusal keeps this copy; nothing is adopted from the disk. `opts.keep` is
   * "Keep this version" for one session (single use: the server also binds it to the disk and candidate hashes).
   */
  async set(key: string, value: string | StateJson, opts: { keep?: boolean } = {}): Promise<DiskWriteResult> {
    // Never 'ok' for a write that went nowhere: while the disk version is adopted, late writes are dropped on purpose.
    if (guard.discarding) return 'fail';
    if (!holdsWriterLock()) return 'browser-only'; // no state of its own to save: the guard of every write path
    const at = Date.now();
    const parts: V2Parts = typeof value === 'string'
      ? { ...splitText(value), savedAt: at }
      : value.v2
        ? { savedAt: at, version: value.v2.version, globals: value.v2.globals, order: value.v2.order, sessions: value.v2.sessions }
        : { ...splitText(value.text()), savedAt: at };
    const rev = ++guard.rev;
    // The disk state the unsent work was built on: the oldest one still unsent, else what the disk holds now.
    const pend: Pending = { rev, baseAt: guard.pending?.baseAt ?? guard.diskAt };
    guard.pending = pend;
    await commitV2(parts, pend);
    // The disk send waits its turn; what to send is decided THEN, against what the disk confirmed by that time (an
    // earlier send may have been acked meanwhile: going back to an older text must still be sent).
    const turn = sendChain.then(() => sendCommit(key, rev, at, parts, opts.keep === true));
    sendChain = turn.then(() => undefined, () => undefined);
    return turn;
  },
  /**
   * "Revert to the disk version": this tab's state goes to a `:conflict-<at>` copy, then the disk's replaces it as the
   * active copy. The page must reload afterwards (late writes of the old memory state are discarded meanwhile).
   */
  async revertToDisk(key: string, current?: string): Promise<void> {
    if (!holdsWriterLock()) return;
    const onDisk = await disk.getState();
    if (!onDisk) throw new Error('The disk copy is not available');
    // The copy of this tab's version comes first (`current`: the memory state, with edits not saved yet): if it cannot be
    // written, nothing is adopted and saving goes on.
    const v2 = current ? null : await readV2();
    const mine = current ?? (v2 ? assembleText(v2) : undefined);
    if (mine) await set(`${key}:conflict-${Date.now()}`, mine, stateStore);
    guard.discarding = true;
    try {
      await commitV2(splitText(onDisk), null);
    } catch (err) {
      guard.discarding = false;
      throw err;
    }
    guard.pending = undefined;
  },
  del: async (key: string) => { if (holdsWriterLock()) await del(`${key}:b`, stateStore); },
};

export const blobDb = {
  /** Browser copy first; a blob only on disk (cleared browser) is read from there and cached again. */
  async get(key: string): Promise<Blob | undefined> {
    const local = await get<Blob>(key, blobStore);
    if (local) return local;
    const onDisk = await disk.getBlob(key);
    if (onDisk && holdsWriterLock()) await set(key, onDisk, blobStore).catch(() => undefined);
    return onDisk;
  },
  async set(key: string, value: Blob): Promise<void> {
    if (!holdsWriterLock()) return;
    const receipt = disk.setBlob(key, value);
    await set(key, value, blobStore);
    const result = await receipt;
    if (result === 'fail' || result === 'conflict') throw new Error(result === 'conflict' ? 'Another tab saved newer work' : 'Disk copy pending');
  },
  async del(key: string): Promise<void> {
    if (!holdsWriterLock()) return;
    disk.delBlobs([key]);
    await del(key, blobStore);
  },
  async delMany(list: string[]): Promise<void> {
    if (!holdsWriterLock()) return;
    disk.delBlobs(list);
    await delMany(list, blobStore);
  },
};

/** Copy to disk the blobs saved before the disk copy existed (or while the server was down). Best effort. */
export async function syncBlobsToDisk(): Promise<void> {
  if (!holdsWriterLock()) return;
  if (!(await diskAvailable())) return;
  const onDisk = new Set(await disk.listBlobs());
  for (const key of await keys(blobStore).catch(() => [])) {
    if (typeof key !== 'string' || onDisk.has(key)) continue;
    const blob = await get<Blob>(key, blobStore);
    // One at a time: a first sync can be hundreds of images and videos.
    if (blob) await disk.setBlob(key, blob);
  }
}

interface Cached<T> {
  at: number;
  value: T;
}

export const cacheDb = {
  async get<T>(key: string, maxAgeMs: number): Promise<T | undefined> {
    try {
      const hit = await get<Cached<T>>(key, cacheStore);
      if (!hit) return undefined;
      if (Date.now() - hit.at > maxAgeMs) return undefined;
      return hit.value;
    } catch {
      return undefined;
    }
  },
  async set<T>(key: string, value: T): Promise<void> {
    try {
      await set(key, { at: Date.now(), value } satisfies Cached<T>, cacheStore);
    } catch {
      /* cache is best effort */
    }
  },
  del: (key: string) => del(key, cacheStore),
};

// ---------------------------------------------------------------------------
// Asset URL cache: object URLs for blobs we hold locally.

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export function assetBlobKey(assetId: string): string {
  return `asset:${assetId}`;
}

export async function putAssetBlob(assetId: string, blob: Blob): Promise<string> {
  await blobDb.set(assetBlobKey(assetId), blob);
  const old = urlCache.get(assetId);
  if (old) URL.revokeObjectURL(old);
  const url = URL.createObjectURL(blob);
  urlCache.set(assetId, url);
  return url;
}

export async function getAssetBlob(assetId: string): Promise<Blob | undefined> {
  return blobDb.get(assetBlobKey(assetId));
}

export function peekAssetUrl(assetId: string): string | undefined {
  return urlCache.get(assetId);
}

export function loadAssetUrl(assetId: string): Promise<string | null> {
  const hit = urlCache.get(assetId);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(assetId);
  if (inflight) return inflight;
  const p = blobDb
    .get(assetBlobKey(assetId))
    .then((blob) => {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urlCache.set(assetId, url);
      return url;
    })
    .catch(() => null)
    .finally(() => pending.delete(assetId));
  pending.set(assetId, p);
  return p;
}

export async function deleteAssetBlobs(assetIds: string[]): Promise<void> {
  for (const id of assetIds) {
    const url = urlCache.get(id);
    if (url) URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
  if (assetIds.length) await blobDb.delMany(assetIds.map(assetBlobKey));
}
