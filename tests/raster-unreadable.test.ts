import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A layer whose stored pixels cannot be read must never be written over with blank pixels (D30).
vi.hoisted(() => {
  const on = () => undefined;
  Object.assign(globalThis, { window: globalThis, location: { port: '5173' }, document: { visibilityState: 'visible', addEventListener: on }, addEventListener: on });
});

const disk = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'fail' | 'missing', writes: [] as string[] }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: {
    get: async () => {
      if (disk.mode === 'fail') throw new Error('NotReadableError');
      return disk.mode === 'missing' ? undefined : Object.assign(new Blob(['x']), { tag: 'original' });
    },
    set: async (key: string, blob: Blob & { tag?: string }) => { disk.writes.push(`${key}=${blob.tag}`); },
    delMany: async () => undefined,
  },
}));
vi.mock('../src/lib/media', () => ({
  createCanvas: (w: number, h: number) => ({ width: w, height: h, tag: 'blank' }),
  ctx2d: () => ({ drawImage: () => undefined, getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }) }),
  canvasToBlob: async (c: { tag: string }) => Object.assign(new Blob(['x']), { tag: c.tag }),
  blobToCanvas: async () => ({ width: 4, height: 4, tag: 'original' }),
}));

import { deleteBuffers, ensureBuffers, getRasterSurface, pendingRaster, setBuffer } from '../src/engine/design/raster';
import type { RasterLayer } from '../src/engine/types';

const layer = (id: string) => ({ id, type: 'raster', name: id, visible: true, locked: false, opacity: 1, blend: 'normal', x: 0, y: 0, width: 4, height: 4, pxWidth: 4, pxHeight: 4, rev: 1 }) as RasterLayer;
const painted = () => ({ width: 4, height: 4, tag: 'painted-on-blank' }) as unknown as HTMLCanvasElement;

beforeEach(() => { vi.useFakeTimers(); disk.writes.length = 0; disk.mode = 'ok'; });
afterEach(async () => { await deleteBuffers(['a', 'b', 'c', ...pendingRaster()]); vi.useRealTimers(); });

describe('unreadable layer pixels (D30)', () => {
  it('a layer whose pixels failed to load is never written over', async () => {
    disk.mode = 'fail';
    await ensureBuffers([layer('a')]);
    expect(getRasterSurface('a')).toBeUndefined();
    setBuffer('a', painted());
    await vi.runAllTimersAsync();
    expect(disk.writes).toEqual([]);
  });

  it('a layer with nothing stored (new, empty) still works and saves', async () => {
    disk.mode = 'missing';
    await ensureBuffers([layer('b')]);
    expect(getRasterSurface('b')).toBeDefined();
    setBuffer('b', painted());
    await vi.runAllTimersAsync();
    expect(disk.writes).toEqual(['raster:b=painted-on-blank']);
  });

  it('a later load that reads the pixels recovers the layer, and it saves again', async () => {
    disk.mode = 'fail';
    await ensureBuffers([layer('c')]);
    disk.mode = 'ok';
    await ensureBuffers([layer('c')]);
    expect(getRasterSurface('c')).toBeDefined();
    setBuffer('c', painted());
    await vi.runAllTimersAsync();
    expect(disk.writes).toEqual(['raster:c=painted-on-blank']);
  });
});
