import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stores, diskState, diskSetState, diskSetBlob, diskPutState, diskSetCommit } = vi.hoisted(() => ({
  stores: new Map<string, Map<string, unknown>>(),
  diskState: { value: null as string | null },
  diskSetState: vi.fn(async (_value: string | { savedAt: number; blob: (open?: string) => Blob }) => 'ok'),
  diskSetBlob: vi.fn(async (_key: string, _value: Blob) => 'ok'),
  diskPutState: vi.fn(async (_value: string, _baseAt: number) => 'ok'),
  diskSetCommit: vi.fn(async (_c: unknown) => 'ok'),
}));

vi.mock('idb-keyval', () => ({
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
  get: async (key: string, store: { name: string }) => stores.get(store.name)?.get(key),
  set: async (key: string, value: unknown, store: { name: string }) => {
    let map = stores.get(store.name);
    if (!map) stores.set(store.name, map = new Map());
    map.set(key, value);
  },
  del: async (key: string, store: { name: string }) => { stores.get(store.name)?.delete(key); },
  delMany: async (keys: string[], store: { name: string }) => keys.forEach((key) => stores.get(store.name)?.delete(key)),
  getMany: async (keys: string[], store: { name: string }) => keys.map((key) => stores.get(store.name)?.get(key)),
  setMany: async (entries: Array<[string, unknown]>, store: { name: string }) => {
    let map = stores.get(store.name);
    if (!map) stores.set(store.name, map = new Map());
    for (const [key, value] of entries) map.set(key, value);
  },
  keys: async (store: { name: string }) => [...(stores.get(store.name)?.keys() ?? [])],
}));

vi.mock('../src/lib/disk', () => ({
  disk: {
    getState: async () => diskState.value,
    putState: diskPutState,
    setState: diskSetState,
    setCommit: diskSetCommit,
    setBlob: diskSetBlob,
    getBlob: async () => undefined,
    listBlobs: async () => [],
    delBlobs: vi.fn(),
    isStale: () => false,
  },
  diskAvailable: async () => true,
}));

const json = (savedAt: number, label: string) => JSON.stringify({ savedAt, label });
const stateStore = () => {
  let map = stores.get('ogs-state');
  if (!map) stores.set('ogs-state', map = new Map());
  return map;
};

async function freshDb() {
  vi.resetModules();
  return (await import('../src/lib/idb')).stateDb;
}

beforeEach(() => {
  stores.clear();
  diskState.value = null;
  diskSetState.mockClear();
  diskSetBlob.mockClear();
  diskPutState.mockClear();
  diskSetCommit.mockClear();
});

describe('state copy recovery', () => {
  it('loads the only available copy from each storage location', async () => {
    const db = await freshDb();
    const legacy = json(10, 'legacy');
    stateStore().set('ogs-app', legacy);
    expect(await db.get('ogs-app')).toBe(legacy);

    stores.clear();
    const blobOnly = new Blob([json(20, 'blob')], { type: 'application/json' });
    stateStore().set('ogs-app:b', blobOnly);
    expect(await db.get('ogs-app')).toBe(json(20, 'blob'));

    stores.clear();
    diskState.value = json(30, 'disk');
    expect(await db.get('ogs-app')).toBe(diskState.value);
  });

  it.each([
    ['legacy then blob', ['legacy', 'blob']],
    ['blob then legacy', ['blob', 'legacy']],
    ['legacy then disk', ['legacy', 'disk']],
    ['disk then legacy', ['disk', 'legacy']],
    ['blob then disk', ['blob', 'disk']],
    ['disk then blob', ['disk', 'blob']],
  ])('chooses the newest copy regardless of storage setup order (%s)', async (_name, order) => {
    const db = await freshDb();
    const values = { legacy: json(10, 'legacy'), blob: json(20, 'blob'), disk: json(30, 'disk') };
    for (const source of order) {
      if (source === 'legacy') stateStore().set('ogs-app', values.legacy);
      if (source === 'blob') stateStore().set('ogs-app:b', new Blob([values.blob], { type: 'application/json' }));
      if (source === 'disk') diskState.value = values.disk;
    }
    expect(await db.get('ogs-app')).toBe(order.includes('disk') ? values.disk : values.blob);
  });

  it('accepts equal timestamps from all three copies without inventing a newer winner', async () => {
    const db = await freshDb();
    const same = json(60, 'shared state');
    stateStore().set('ogs-app', same);
    stateStore().set('ogs-app:b', new Blob([same], { type: 'application/json' }));
    diskState.value = same;

    expect(await db.get('ogs-app')).toBe(same);
  });

  it.each([
    [10, 20, 30], [10, 30, 20], [20, 10, 30],
    [20, 30, 10], [30, 10, 20], [30, 20, 10],
  ])('selects the newest of all three copies for timestamp order %j', async (legacyAt, blobAt, diskAt) => {
    const db = await freshDb();
    const values = {
      legacy: json(legacyAt, 'legacy'),
      blob: json(blobAt, 'blob'),
      disk: json(diskAt, 'disk'),
    };
    stateStore().set('ogs-app', values.legacy);
    stateStore().set('ogs-app:b', new Blob([values.blob], { type: 'application/json' }));
    diskState.value = values.disk;
    const newest = legacyAt > blobAt && legacyAt > diskAt ? values.legacy
      : blobAt > diskAt ? values.blob : values.disk;

    expect(await db.get('ogs-app')).toBe(newest);
  });

  it('keeps a rejected newer local copy active and under a conflict key (the disk copy is not adopted)', async () => {
    const db = await freshDb();
    const local = json(50, 'local work');
    const disk = json(40, 'disk work');
    stateStore().set('ogs-app:b', new Blob([local], { type: 'application/json' }));
    diskState.value = disk;
    diskPutState.mockResolvedValueOnce('conflict');

    expect(await db.get('ogs-app')).toBe(local);
    const kept = [...stateStore().entries()].filter(([key]) => String(key).startsWith('ogs-app:conflict-'));
    expect(kept).toHaveLength(1);
    expect(kept[0][1]).toBe(local);
  });

  it('keeps a refused write in the browser and as a conflict copy; the disk copy is not adopted', async () => {
    const db = await freshDb();
    diskState.value = json(80, 'newer disk work');
    diskSetCommit.mockResolvedValueOnce('conflict');
    const refused = JSON.stringify({ savedAt: 90, state: { settings: {}, sessions: { ses_mine: { id: 'ses_mine' } } }, version: 1 });
    expect(await db.set('ogs-app', { text: () => refused, blob: () => new Blob([refused]), v2: { version: 1, globals: '{"settings":{}}', order: ['ses_mine'], sessions: new Map([['ses_mine', '{"id":"ses_mine"}']]) } } as never)).toBe('conflict');
    const kept = [...stateStore()].filter(([key]) => String(key).startsWith('ogs-app:conflict-'));
    expect(kept).toHaveLength(1);
    expect(String(kept[0][1])).toContain('ses_mine');
    // The refused state stays the active format-2 copy (a stale disk never replaces it); the format-1 keys are left alone.
    const v2 = stores.get('ogs-store-v2')!;
    expect(v2.get('session:ses_mine')).toBe('{"id":"ses_mine"}');
    expect(v2.get('manifest')).toEqual(expect.objectContaining({ savedAt: expect.any(Number) }));
    expect(stateStore().has('ogs-app')).toBe(false);
  });

  it('writes a Blob copy without reading its text or writing the legacy key', async () => {
    const db = await freshDb();
    const value = {
      text: vi.fn(() => 'large state bytes'),
      blob: vi.fn(() => new Blob(['large state bytes'])),
      v2: { version: 1, globals: '{"settings":{}}', order: ['ses_a'], sessions: new Map([['ses_a', '{"id":"ses_a"}']]) },
    };

    expect(await db.set('ogs-app', value as never)).toBe('ok');

    // Format 2: the session records are written and the disk gets a commit; no whole-state text is built.
    expect(value.text).not.toHaveBeenCalled();
    expect(value.blob).not.toHaveBeenCalled();
    expect(stateStore().has('ogs-app')).toBe(false);
    expect(stores.get('ogs-store-v2')!.get('session:ses_a')).toBe('{"id":"ses_a"}');
    expect(diskSetCommit).toHaveBeenCalledWith(expect.objectContaining({ order: ['ses_a'], changed: [['ses_a', '{"id":"ses_a"}']] }));
  });
});
