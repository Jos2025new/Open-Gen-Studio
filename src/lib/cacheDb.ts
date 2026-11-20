import { clear, createStore, del, get, set } from 'idb-keyval';

const cacheStore = createStore('ogs-cache', 'kv');

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

export const clearCatalogCache = (): Promise<void> => clear(cacheStore);
