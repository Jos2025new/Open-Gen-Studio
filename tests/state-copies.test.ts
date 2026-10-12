import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stores, diskState, diskSetState, diskSetBlob, diskPutState } = vi.hoisted(() => ({
  stores: new Map<string, Map<string, unknown>>(),
  diskState: { value: null as string | null },
  diskSetState: vi.fn(async (_value: string | { savedAt: number; blob: (open?: string) => Blob }) => 'ok'),
  diskSetBlob: vi.fn(async (_key: string, _value: Blob) => 'ok'),
  diskPutState: vi.fn(async (_value: string, _baseAt: number) => 'ok'),
}));

vi.mock('idb-keyval', () => ({
  createStore: (name: string) => ({ name }),
  get: async (key: string, store: { name: string }) => stores.get(store.name)?.get(key),
  set: async (key: string, value: unknown, store: { name: string }) => {
    let map = stores.get(store.name);
    if (!map) stores.set(store.name, map = new Map());
    map.set(key, value);
  },
  del: async (key: string, store: { name: string }) => { stores.get(store.name)?.delete(key); },
  delMany: async (keys: string[], store: { name: string }) => keys.forEach((key) => stores.get(store.name)?.delete(key)),
  keys: async (store: { name: string }) => [...(stores.get(store.name)?.keys() ?? [])],
}));

vi.mock('../src/lib/disk', () => ({
  disk: {
    getState: async () => diskState.value,
    putState: diskPutState,
    setState: diskSetState,
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

  it('preserves a rejected newer local copy under a conflict key', async () => {
    const db = await freshDb();
    const local = json(50, 'local work');
    const disk = json(40, 'disk work');
    stateStore().set('ogs-app:b', new Blob([local], { type: 'application/json' }));
    diskState.value = disk;
    diskPutState.mockResolvedValueOnce('conflict');

    expect(await db.get('ogs-app')).toBe(disk);
    const kept = [...stateStore().entries()].filter(([key]) => String(key).startsWith('ogs-app:conflict-'));
    expect(kept).toHaveLength(1);
    expect(kept[0][1]).toBe(local);
  });

  it('keeps a refused write separately and restores the confirmed disk copy', async () => {
    const db = await freshDb();
    diskState.value = json(80, 'newer disk work');
    diskSetState.mockResolvedValueOnce('conflict');
    expect(await db.set('ogs-app', '{"state":{}}')).toBe('conflict');
    const kept = [...stateStore()].filter(([key]) => String(key).startsWith('ogs-app:conflict-'));
    expect(kept).toHaveLength(1);
    expect(await (kept[0][1] as Blob).text()).toContain('"state":{}');
    expect(await (stateStore().get('ogs-app:b') as Blob).text()).toBe(diskState.value);
    expect(stateStore().has('ogs-app')).toBe(false);
  });

  it('writes a Blob copy without reading its text or writing the legacy key', async () => {
    const db = await freshDb();
    const blob = new Blob(['large state bytes'], { type: 'application/json' });
    const value = {
      text: vi.fn(() => 'large state bytes'),
      blob: vi.fn(() => blob),
    };

    expect(await db.set('ogs-app', value as never)).toBe('ok');

    expect(value.text).not.toHaveBeenCalled();
    expect(value.blob).toHaveBeenCalled();
    expect(stateStore().has('ogs-app')).toBe(false);
    expect(stateStore().get('ogs-app:b')).toBe(blob);
    expect(diskSetState).toHaveBeenCalled();
  });
});
