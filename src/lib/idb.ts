import { createStore, del, get, set, delMany } from 'idb-keyval';

/**
 * IndexedDB stores:
 *  - `state`: the persisted app state (one JSON document)
 *  - `blobs`: media bytes for assets and designer raster layers
 *  - `cache`: provider catalogs and model schemas (with timestamps)
 */
const stateStore = createStore('ogs-state', 'kv');
const blobStore = createStore('ogs-blobs', 'kv');
const cacheStore = createStore('ogs-cache', 'kv');

export const stateDb = {
  get: (key: string) => get<string>(key, stateStore),
  set: (key: string, value: string) => set(key, value, stateStore),
  del: (key: string) => del(key, stateStore),
};

export const blobDb = {
  get: (key: string) => get<Blob>(key, blobStore),
  set: (key: string, value: Blob) => set(key, value, blobStore),
  del: (key: string) => del(key, blobStore),
  delMany: (keys: string[]) => delMany(keys, blobStore),
};

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
