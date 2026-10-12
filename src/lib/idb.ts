import { createStore, del, get, set, delMany, keys } from 'idb-keyval';
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
const stamp = (value: string) => `{"savedAt":${Date.now()},${value.slice(1)}`;
const savedAt = (value: string | null | undefined) => Number(/^\{"savedAt":(\d+)/.exec(value ?? '')?.[1] ?? 0);

export const stateDb = {
  /** Read legacy text, Blob and disk; legacy bytes are never overwritten or deleted. */
  async get(key: string): Promise<string | undefined> {
    const [legacy, current, onDisk] = await Promise.all([
      get<string>(key, stateStore), get<Blob | string>(`${key}:b`, stateStore), disk.getState(),
    ]);
    const text = current instanceof Blob ? await current.text() : current;
    const local = savedAt(text) >= savedAt(legacy) ? text ?? legacy : legacy;
    if (onDisk && savedAt(onDisk) > savedAt(local)) {
      await set(`${key}:b`, new Blob([onDisk], { type: 'application/json' }), stateStore);
      return onDisk;
    }
    if (local && onDisk && savedAt(local) > savedAt(onDisk)) {
      if ((await disk.putState(local, savedAt(onDisk))) === 'conflict') {
        await set(`${key}:conflict-${Date.now()}`, local, stateStore);
        await set(`${key}:b`, new Blob([onDisk], { type: 'application/json' }), stateStore);
        return onDisk;
      }
    } else if (local && !onDisk) await disk.setState(local);
    return local ?? undefined;
  },
  async set(key: string, value: string | StateJson): Promise<DiskWriteResult> {
    if (disk.isStale()) return 'conflict';
    const at = Date.now();
    const stamped = typeof value === 'string' ? (value.startsWith('{') ? stamp(value) : value) : null;
    const blob = typeof value === 'string'
      ? new Blob([stamped!], { type: 'application/json' })
      : value.blob(`{"savedAt":${at},`);
    // The same encoded body is reused; adding baseAt builds only the small prefix for disk.
    const receipt = disk.setState(typeof value === 'string' ? stamped! : { savedAt: at, blob: (open) => value.blob(open) });
    await set(`${key}:b`, blob, stateStore);
    const result = await receipt;
    if (result === 'conflict') {
      await set(`${key}:conflict-${at}`, blob, stateStore);
      // Never offer this refused write as a recovery candidate on the next load.
      const onDisk = await disk.getState();
      if (onDisk) await set(`${key}:b`, new Blob([onDisk], { type: 'application/json' }), stateStore);
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
