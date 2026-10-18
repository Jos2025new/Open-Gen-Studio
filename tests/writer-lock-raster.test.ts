// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idbKeyval, idbStores, resetWorld, settle, until } from './helpers/fakeTabs';

/*
 * Plan 1.4, tests 10 and 15c for painting: a stroke still deferred in the old tab is written before the lock is
 * released, and a tab without the lock paints into memory only.
 */
vi.mock('idb-keyval', () => idbKeyval());
// A canvas is a plain object; its "pixels" are a tag the fake PNG encoder copies.
vi.mock('../src/lib/media', () => ({
  createCanvas: (w: number, h: number) => ({ width: w, height: h, tag: 'blank' }),
  ctx2d: () => ({ drawImage: () => undefined }),
  canvasToBlob: async (c: { tag: string }) => Object.assign(new Blob([c.tag]), { tag: c.tag }),
  blobToCanvas: async () => ({ width: 1, height: 1 }),
}));
vi.mock('../src/lib/log', () => ({ logEvent: () => undefined, logged: (_: string, f: unknown) => f, logSettled: async () => undefined }));

const canvas = (tag: string) => ({ width: 4, height: 4, tag }) as unknown as HTMLCanvasElement;
const writes: string[] = [];
async function openTab() {
  vi.resetModules();
  const lock = await import('../src/lib/writerLock');
  const store = await import('../src/store/store');
  await import('../src/store/writerHandoff');
  const raster = await import('../src/engine/design/raster');
  return { lock, store, raster, state: () => store.useStore.getState() };
}
const blobs = () => [...(idbStores().get('ogs-blobs') ?? new Map())].map(([k, v]) => `${k}=${(v as { tag?: string }).tag}`);

let world: ReturnType<typeof resetWorld>;
beforeEach(() => {
  world = resetWorld();
  writes.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') writes.push(`${init?.method} ${url}`);
    return url === '/x/store/ping' ? new Response('ok') : url === '/x/store/blobs' ? new Response('[]') : new Response(null, { status: 204 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('painting and the writer lock', () => {
  it('a tab without the lock paints into memory only: no blob in IndexedDB, nothing on the disk', async () => {
    const a = await openTab();
    await until(() => a.state().hydrated);
    const b = await openTab();
    await settle();
    expect(b.lock.holdsWriterLock()).toBe(false);
    writes.length = 0; // tab A's own loading is not the question
    b.raster.setBuffer('layer_b', canvas('stroke-b'));
    await b.raster.flushRaster();
    await b.raster.deleteBuffers(['layer_b']);
    await b.store.saveNow();
    await settle();
    expect(blobs()).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('"Use here" writes the stroke still deferred in the old tab before releasing the lock', async () => {
    const a = await openTab();
    await until(() => a.state().hydrated);
    a.raster.setBuffer('layer_a', canvas('stroke-1')); // scheduled for later, not written
    expect(a.raster.pendingRaster()).toEqual(['layer_a']);
    expect(blobs()).toEqual([]);
    // The asking tab, as the channel and the lock manager see it (a second module copy would also swap the lazy
    // imports of tab A, which is a test artefact): it asks, and sees what IndexedDB holds the moment the lock is its.
    const ghost = new world.bus.Chan('ogs-writer');
    let atGrant: string[] | undefined;
    const granted = new Promise<void>((resolve) => { void world.locks.request('ogs-writer', () => { atGrant = blobs(); resolve(); return new Promise(() => undefined); }); });
    ghost.postMessage({ type: 'ask', from: 'ghost' });
    await granted;
    expect(atGrant).toEqual(['raster:layer_a=stroke-1']);
    expect(a.lock.holdsWriterLock()).toBe(false);
    // And once read-only, the old tab's later strokes are not written.
    a.raster.setBuffer('layer_a', canvas('stroke-2'));
    await a.raster.flushRaster();
    expect(blobs()).toEqual(['raster:layer_a=stroke-1']);
  });
});
