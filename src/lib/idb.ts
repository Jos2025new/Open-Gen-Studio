import { createStore, del, get, getMany, set, delMany, keys } from 'idb-keyval';
import { assembleText, splitText, type V2Parts } from '../store/formatV2';
import { disk, diskAvailable, type DiskWriteResult } from './disk';
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

/** Publishes a format-2 state atomically: changed and removed sessions, globals and manifest in one transaction. */
async function commitV2(p: V2Parts): Promise<void> {
  const changed: Array<[string, string]> = [];
  for (const [id, text] of p.sessions) if (committed.get(id) !== text) changed.push([`session:${id}`, text]);
  const removed = [...committed.keys()].filter((id) => !p.sessions.has(id)).map((id) => `session:${id}`);
  // One readwrite transaction: a reader sees the old revision or the new one, never a manifest without its sessions.
  await v2Store('readwrite', (store) => {
    for (const [key, text] of changed) store.put(text, key);
    for (const key of removed) store.delete(key);
    store.put(p.globals, 'globals');
    store.put({ savedAt: p.savedAt, version: p.version, order: p.order }, 'manifest');
    const tx = store.transaction;
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB commit aborted'));
    });
  });
  committed.clear();
  for (const [id, text] of p.sessions) committed.set(id, text);
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

export const stateDb = {
  /**
   * The state text: format 2 when it exists, else format 1, which is migrated on this load. A disk copy that is newer
   * is adopted (it becomes format 2 too); a newer local copy is pushed to the disk.
   */
  async get(key: string): Promise<string | undefined> {
    const v2 = await readV2();
    const legacy = v2 ? undefined : await readLegacy(key);
    const onDisk = await disk.getState();
    if (v2) for (const [id, text] of v2.sessions) committed.set(id, text);
    const local = v2 ? assembleText(v2) : legacy;
    if (onDisk && savedAt(onDisk) > savedAt(local)) {
      await backupLegacy(key, legacy);
      await commitV2(splitText(onDisk));
      return onDisk;
    }
    if (local && onDisk && savedAt(local) > savedAt(onDisk)) {
      if ((await disk.putState(local, savedAt(onDisk))) === 'conflict') {
        await set(`${key}:conflict-${Date.now()}`, local, stateStore);
        await backupLegacy(key, legacy);
        await commitV2(splitText(onDisk));
        return onDisk;
      }
    } else if (local && !onDisk) await disk.setState(local);
    if (legacy) {
      await backupLegacy(key, legacy);
      await commitV2(splitText(legacy));
    }
    return local ?? undefined;
  },
  /** Saves a state: format 2 locally first, then the disk commit. A disk conflict keeps this copy and adopts the disk's. */
  async set(key: string, value: string | StateJson): Promise<DiskWriteResult> {
    if (disk.isStale()) return 'conflict';
    const at = Date.now();
    const parts: V2Parts = typeof value === 'string'
      ? { ...splitText(value), savedAt: at }
      : value.v2
        ? { savedAt: at, version: value.v2.version, globals: value.v2.globals, order: value.v2.order, sessions: value.v2.sessions }
        : { ...splitText(value.text()), savedAt: at };
    const before = new Map(committed);
    await commitV2(parts);
    const changed = parts.order
      .filter((id) => before.get(id) !== parts.sessions.get(id))
      .map((id) => [id, parts.sessions.get(id)!] as [string, string]);
    const all = parts.order.map((id) => [id, parts.sessions.get(id)!] as [string, string]);
    const result = await disk.setCommit({ savedAt: at, version: parts.version, globals: parts.globals, order: parts.order, changed, all });
    if (result === 'conflict') {
      await set(`${key}:conflict-${at}`, assembleText(parts), stateStore);
      const onDisk = await disk.getState();
      if (onDisk) await commitV2(splitText(onDisk));
    }
    return result;
  },
  del: (key: string) => del(`${key}:b`, stateStore),
};

export const blobDb = {
  /** Browser copy first; a blob only on disk (cleared browser) is read from there and cached again. */
  async get(key: string): Promise<Blob | undefined> {
    const local = await get<Blob>(key, blobStore);
    if (local) return local;
    const onDisk = await disk.getBlob(key);
    if (onDisk) await set(key, onDisk, blobStore).catch(() => undefined);
    return onDisk;
  },
  async set(key: string, value: Blob): Promise<void> {
    const receipt = disk.setBlob(key, value);
    await set(key, value, blobStore);
    const result = await receipt;
    if (result === 'fail' || result === 'conflict') throw new Error(result === 'conflict' ? 'Another tab saved newer work' : 'Disk copy pending');
  },
  async del(key: string): Promise<void> {
    disk.delBlobs([key]);
    await del(key, blobStore);
  },
  async delMany(list: string[]): Promise<void> {
    disk.delBlobs(list);
    await delMany(list, blobStore);
  },
};

/** Copy to disk the blobs saved before the disk copy existed (or while the server was down). Best effort. */
export async function syncBlobsToDisk(): Promise<void> {
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
