// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idbKeyval, idbStores, resetWorld, settle, snapshotDbs, until } from './helpers/fakeTabs';

/*
 * Plan 1.4, tests 10 and 15c: one tab writes. The real writerLock, idb, disk and store modules run in several "tabs"
 * (module copies) over a shared fake Web Locks manager, BroadcastChannel, IndexedDB and disk server.
 */
vi.mock('idb-keyval', () => idbKeyval());
vi.mock('../src/engine/design/raster', () => ({ flushRaster: async () => undefined, pendingRaster: () => [] }));

const net = vi.hoisted(() => ({ writes: [] as string[], disk: '' }));
function stubDisk() {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/x/store/ping') return new Response('ok');
    if (url === '/x/store/state' && method === 'GET') return new Response(net.disk);
    if (url === '/x/store/blobs') return new Response('[]');
    if (method !== 'GET') net.writes.push(`${method} ${url}`);
    return new Response(null, { status: 204 });
  });
}

/** A fresh page: app modules reloaded, the shared world kept. */
async function openTab() {
  vi.resetModules();
  const lock = await import('../src/lib/writerLock');
  const idb = await import('../src/lib/idb');
  const store = await import('../src/store/store');
  await import('../src/store/writerHandoff');
  return { lock, idb, store, state: () => store.useStore.getState(), set: store.useStore.setState };
}
type Tab = Awaited<ReturnType<typeof openTab>>;
const hydrated = (t: Tab) => until(() => t.state().hydrated);

let world: ReturnType<typeof resetWorld>;
beforeEach(() => { world = resetWorld(); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })); net.writes.length = 0; net.disk = ''; stubDisk(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('test 10: a tab without the writer lock changes nothing', () => {
  it('does not hydrate and does not read state before it holds the lock', async () => {
    const a = await openTab();
    await hydrated(a);
    const b = await openTab();
    await settle();
    expect(a.lock.holdsWriterLock()).toBe(true);
    expect(b.lock.holdsWriterLock()).toBe(false);
    expect(b.state().hydrated).toBe(false);
    expect(b.store.useStore.persist.hasHydrated()).toBe(false);
  });

  it('setState, a blob write, syncBlobsToDisk, stateDb.set and a wipe change neither IndexedDB nor the disk', async () => {
    const a = await openTab();
    await hydrated(a);
    a.set({ spentUsd: 5 });
    await a.store.saveNow();
    await a.idb.blobDb.set('asset:one', new Blob(['one']));
    const before = snapshotDbs(), diskWrites = net.writes.length;
    expect(before).toContain('"spentUsd\\":5');

    const b = await openTab();
    await settle();
    b.set({ spentUsd: 99 });
    await b.store.saveNow();
    await b.idb.blobDb.set('asset:two', new Blob(['two']));
    await b.idb.blobDb.del('asset:one');
    await b.idb.blobDb.delMany(['asset:one']);
    await b.idb.putAssetBlob('three', new Blob(['three']));
    await b.idb.deleteAssetBlobs(['one']);
    await b.idb.syncBlobsToDisk();
    await b.idb.stateDb.set('ogs-app', JSON.stringify({ savedAt: 1, state: { sessions: {} }, version: 1 }));
    await b.idb.stateDb.revertToDisk('ogs-app');
    await b.idb.stateDb.del('ogs-app');
    await b.idb.wipeLocalDatabases();
    await b.store.wipeAllData();
    await settle();
    expect(snapshotDbs()).toBe(before);
    expect(net.writes.length).toBe(diskWrites);
    await expect(b.idb.stateDb.get('ogs-app')).resolves.toBeUndefined();
  });
});

describe('test 15c: "Use here" hands the work over completely', () => {
  it('the old tab saves what is pending, releases, goes read-only; the new tab hydrates without reloading and sees it', async () => {
    const a = await openTab();
    await hydrated(a);
    a.set({ spentUsd: 7 }); // debounced: not written yet
    expect(JSON.stringify([...(idbStores().get('ogs-store-v2') ?? [])])).not.toContain('spentUsd\\":7');

    const b = await openTab();
    await settle();
    expect(b.state().hydrated).toBe(false);
    b.lock.useHere();
    await hydrated(b);
    expect(b.lock.holdsWriterLock()).toBe(true);
    expect(b.state().spentUsd).toBe(7);
    expect(a.lock.holdsWriterLock()).toBe(false);
    expect(a.state().hydrated).toBe(false);

    // The old tab, now read-only, writes nothing.
    const before = snapshotDbs();
    a.set({ spentUsd: 8 });
    await a.store.saveNow();
    await settle();
    expect(snapshotDbs()).toBe(before);
    // The new tab saves normally.
    b.set({ spentUsd: 9 });
    await b.store.saveNow();
    expect(snapshotDbs()).not.toBe(before);
  });

  it('a tab that does not answer in 5 s is not taken from: the new tab waits, and takes over with the IndexedDB state once the old one closes', async () => {
    const a = await openTab();
    await hydrated(a);
    a.set({ spentUsd: 3 });
    await a.store.saveNow();
    const b = await openTab();
    await settle();
    world.bus.deaf.add(1); // the first tab is frozen: hears nothing
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    b.lock.useHere();
    await vi.advanceTimersByTimeAsync(100);
    expect(b.lock.getWriterState().asking).toBe('asking');
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.lock.getWriterState().asking).toBe('silent');
    vi.useRealTimers();
    expect('takeOver' in b.lock).toBe(false); // no steal: it would not stop the requests the old tab already sent
    await settle();
    expect(b.lock.holdsWriterLock()).toBe(false);
    expect(a.lock.holdsWriterLock()).toBe(true);
    world.locks.terminate(); // the user closes the frozen tab
    await hydrated(b);
    expect(b.state().spentUsd).toBe(3);
  });

  it('a tab waiting in the queue takes the lock by itself when the holder tab closes, and hydrates', async () => {
    const a = await openTab();
    await hydrated(a);
    a.set({ spentUsd: 6 });
    await a.store.saveNow();
    const b = await openTab();
    await settle();
    expect(b.lock.holdsWriterLock()).toBe(false);
    world.locks.terminate();
    await hydrated(b);
    expect(b.lock.holdsWriterLock()).toBe(true);
    expect(b.state().spentUsd).toBe(6);
  });

  it('without Web Locks the tab is read-only with its own state', async () => {
    Object.defineProperty(globalThis.navigator, 'locks', { value: undefined, configurable: true });
    const a = await openTab();
    await settle();
    expect(a.lock.getWriterState().phase).toBe('unsupported');
    expect(a.lock.holdsWriterLock()).toBe(false);
    expect(a.state().hydrated).toBe(false);
    a.set({ spentUsd: 1 });
    await a.store.saveNow();
    expect(snapshotDbs()).not.toContain('spentUsd');
  });
});
