import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stores, diskState, diskSetCommit, diskSetState, diskPutState } = vi.hoisted(() => ({
  stores: new Map<string, Map<string, unknown>>(),
  diskState: { value: null as string | null },
  diskSetCommit: vi.fn(async (_c: unknown) => 'ok' as string),
  diskSetState: vi.fn(async (_v: unknown) => 'ok'),
  diskPutState: vi.fn(async (_v: string, _b: number) => 'ok'),
}));

vi.mock('idb-keyval', () => {
  const map = (store: { name: string }) => { let m = stores.get(store.name); if (!m) stores.set(store.name, m = new Map()); return m; };
  return {
    createStore: (name: string) => {
    // idb-keyval's store is a function (mode, callback(IDBObjectStore)); this one applies puts/deletes to the map.
    const run = async (_mode: string, cb: (store: unknown) => unknown) => {
      let map = stores.get(name);
      if (!map) stores.set(name, map = new Map());
      const tx: { oncomplete?: () => void } = {};
      const result = cb({ transaction: tx, put: (v: unknown, k: string) => { map!.set(k, v); }, delete: (k: string) => { map!.delete(k); } });
      queueMicrotask(() => tx.oncomplete?.());
      return result;
    };
    return Object.defineProperty(run, 'name', { value: name });
  },
    get: async (key: string, store: { name: string }) => map(store).get(key),
    set: async (key: string, value: unknown, store: { name: string }) => { map(store).set(key, value); },
    del: async (key: string, store: { name: string }) => { map(store).delete(key); },
    delMany: async (keys: string[], store: { name: string }) => keys.forEach((k) => map(store).delete(k)),
    getMany: async (keys: string[], store: { name: string }) => keys.map((k) => map(store).get(k)),
    setMany: async (entries: Array<[string, unknown]>, store: { name: string }) => { for (const [k, v] of entries) map(store).set(k, v); },
    keys: async (store: { name: string }) => [...map(store).keys()],
  };
});

vi.mock('../src/lib/disk', () => ({
  disk: {
    getState: async () => diskState.value,
    putState: diskPutState,
    setState: diskSetState,
    setCommit: diskSetCommit,
    setBlob: async () => 'ok',
    getBlob: async () => undefined,
    listBlobs: async () => [],
    delBlobs: vi.fn(),
    isStale: () => false,
    reset: () => undefined,
  },
  diskAvailable: async () => true,
}));

const parts = (sessions: Record<string, unknown>, savedAt = 0, settings = { theme: 'dark' }) => {
  const order = Object.keys(sessions);
  return {
    text: () => JSON.stringify({ savedAt, state: { settings, sessions }, version: 1 }),
    blob: () => new Blob([JSON.stringify({ savedAt, state: { settings, sessions }, version: 1 })]),
    v2: { version: 1, globals: JSON.stringify({ settings }), order, sessions: new Map(order.map((id) => [id, JSON.stringify(sessions[id])])) },
  };
};
async function freshDb() { vi.resetModules(); return (await import('../src/lib/idb')).stateDb; }

beforeEach(() => { stores.clear(); diskState.value = null; diskSetCommit.mockClear(); diskSetCommit.mockResolvedValue('ok'); });

describe('format 2 in the browser (ADR 0014)', () => {
  it('migrates a format-1 browser copy: copied whole first, original keys untouched', async () => {
    const legacy = JSON.stringify({ savedAt: 50, state: { settings: { theme: 'light' }, sessions: { ses_a: { id: 'ses_a' } } }, version: 1 });
    stores.set('ogs-state', new Map([['ogs-app:b', new Blob([legacy])]]));
    const db = await freshDb();
    expect(JSON.parse((await db.get('ogs-app'))!).state.sessions).toEqual({ ses_a: { id: 'ses_a' } });
    const v2 = stores.get('ogs-store-v2')!;
    expect(v2.get('manifest')).toEqual(expect.objectContaining({ savedAt: 50, order: ['ses_a'] }));
    expect(stores.get('ogs-state')!.get('ogs-app:format1-backup-50')).toBe(legacy);
    expect(stores.get('ogs-state')!.get('ogs-app:b')).toBeInstanceOf(Blob);
  });

  it('a change to one session commits only that session to the disk', async () => {
    const db = await freshDb();
    await db.set('ogs-app', parts({ ses_a: { id: 'ses_a' }, ses_b: { id: 'ses_b' }, ses_c: { id: 'ses_c' } }) as never);
    await db.set('ogs-app', parts({ ses_a: { id: 'ses_a' }, ses_b: { id: 'ses_b', edited: true }, ses_c: { id: 'ses_c' } }) as never);
    const second = diskSetCommit.mock.calls[1][0] as { changed: Array<[string, string]>; order: string[] };
    expect(second.changed.map(([id]) => id)).toEqual(['ses_b']);
    expect(second.order).toEqual(['ses_a', 'ses_b', 'ses_c']);
  });

  it('a reload gives back the same state that was saved', async () => {
    const db = await freshDb();
    const sessions = { ses_a: { id: 'ses_a', msgs: ['x', 'y'] }, ses_b: { id: 'ses_b' } };
    await db.set('ogs-app', parts(sessions, 0, { theme: 'dark' }) as never);
    const db2 = await freshDb();
    const loaded = JSON.parse((await db2.get('ogs-app'))!);
    expect(loaded.state).toEqual({ settings: { theme: 'dark' }, sessions });
    expect(loaded.version).toBe(1);
  });

  it('a lost disk does not lose the local state: the copy stays in the browser, the write says so', async () => {
    const db = await freshDb();
    diskSetCommit.mockResolvedValueOnce('browser-only');
    expect(await db.set('ogs-app', parts({ ses_a: { id: 'ses_a' } }) as never)).toBe('browser-only');
    expect(stores.get('ogs-store-v2')!.get('session:ses_a')).toBe('{"id":"ses_a"}');
  });

  it('a dead disk server (failed write) keeps the browser copy and reports the failure, never a false save', async () => {
    const db = await freshDb();
    diskSetCommit.mockResolvedValueOnce('fail');
    expect(await db.set('ogs-app', parts({ ses_a: { id: 'ses_a' } }) as never)).toBe('fail');
    expect(stores.get('ogs-store-v2')!.get('session:ses_a')).toBe('{"id":"ses_a"}');
    expect(stores.get('ogs-store-v2')!.get('manifest')).toEqual(expect.objectContaining({ order: ['ses_a'] }));
  });
});
