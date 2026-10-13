import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Raster saves wait for idle time (requestIdleCallback, 1 s at most) and several strokes share one write.
const writes = vi.hoisted(() => [] as string[]);
const idle = vi.hoisted(() => ({ queue: new Map<number, { fn: () => void; timeout: number }>(), next: 1, cancelled: 0 }));
vi.hoisted(() => {
  const on = () => undefined;
  Object.assign(globalThis, { window: globalThis, location: { port: '5173' }, document: { visibilityState: 'visible', addEventListener: on }, addEventListener: on });
  Object.assign(globalThis, {
    requestIdleCallback: (fn: () => void, o?: { timeout?: number }) => { const id = idle.next++; idle.queue.set(id, { fn, timeout: o?.timeout ?? 0 }); return id; },
    cancelIdleCallback: (id: number) => { idle.cancelled++; idle.queue.delete(id); },
  });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: {
    get: async () => undefined,
    set: async (key: string, blob: Blob & { tag?: string }) => { writes.push(`${key}=${blob.tag}`); },
    delMany: async () => undefined,
  },
}));
vi.mock('../src/lib/media', () => ({
  createCanvas: (w: number, h: number) => ({ width: w, height: h, tag: 'blank' }),
  ctx2d: () => ({ drawImage: () => undefined }),
  canvasToBlob: async (c: { tag: string }) => Object.assign(new Blob(['x']), { tag: c.tag }),
  blobToCanvas: async () => ({ width: 1, height: 1 }),
}));

import { deleteBuffers, flushRaster, pendingRaster, setBuffer } from '../src/engine/design/raster';

const canvas = (tag: string) => ({ width: 4, height: 4, tag }) as unknown as HTMLCanvasElement;
/** Run the idle callbacks queued so far, as the browser does when it has time. */
function runIdle(): void {
  const now = [...idle.queue.entries()];
  idle.queue.clear();
  for (const [, job] of now) job.fn();
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); writes.length = 0; idle.queue.clear(); idle.cancelled = 0; });
afterEach(async () => { await deleteBuffers(pendingRaster()); vi.useRealTimers(); });

describe('raster saves wait for idle time', () => {
  it('does not write at 700 ms: the write waits for an idle callback', async () => {
    setBuffer('idle-a', canvas('v1'));
    await vi.advanceTimersByTimeAsync(800);
    expect(writes).toEqual([]);
    expect(idle.queue.size).toBe(1);
    expect([...idle.queue.values()][0].timeout).toBe(1000);
    expect(pendingRaster()).toEqual(['idle-a']);
  });

  it('coalesces several changes into one write of the latest pixels, and stays pending until it lands', async () => {
    setBuffer('idle-b', canvas('v1'));
    setBuffer('idle-b', canvas('v2'));
    setBuffer('idle-b', canvas('v3'));
    expect(idle.queue.size).toBe(1);
    expect(idle.cancelled).toBe(2);
    runIdle();
    await vi.advanceTimersByTimeAsync(0);
    // The idle write alone stores the latest pixels of the layer; the first test's layer may write its own.
    expect(writes.filter((w) => w.startsWith('raster:idle-b'))).toEqual(['raster:idle-b=v3']);
    await flushRaster();
    expect(pendingRaster()).not.toContain('idle-b');
  });
});
