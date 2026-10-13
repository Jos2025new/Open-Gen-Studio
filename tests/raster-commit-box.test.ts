import { beforeEach, describe, expect, it, vi } from 'vitest';

// A canvas is a fake with a pixel array; every getImageData is counted, so a scan on pointer-up shows up.
const reads = vi.hoisted(() => ({ count: 0 }));
vi.hoisted(() => {
  const on = () => undefined;
  Object.assign(globalThis, { window: globalThis, location: { port: '5173' }, document: { visibilityState: 'visible', addEventListener: on }, addEventListener: on });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, delMany: async () => undefined },
}));
vi.mock('../src/lib/media', () => {
  const fake = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => {
        if (k === 'getImageData') return () => { reads.count++; return { data }; };
        if (k === 'putImageData' || k === 'drawImage') return () => undefined;
        return () => undefined;
      },
      set: () => true,
    });
    return { width: w, height: h, data, getContext: () => ctx };
  };
  return {
    createCanvas: (w: number, h: number) => fake(w, h),
    ctx2d: (c: { getContext: (k: string) => unknown }) => c.getContext('2d'),
    canvasToBlob: async () => new Blob(['x']),
    blobToCanvas: async () => fake(1, 1),
  };
});

import { beginEdit, commitEdit, getRasterSurface, setBuffer } from '../src/engine/design/raster';
import { paintLive, beginLiveStroke } from '../src/engine/design/raster';
import { pixelBox } from '../src/engine/design/render';
import { rasterPaintedBox } from '../src/engine/design/rasterBounds';
import { place } from '../src/engine/design/rasterSurface';
import type { RasterLayer } from '../src/engine/types';

const SIZE = 128;
function solid(c: { data: Uint8ClampedArray; width: number }, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) c.data[(y * c.width + x) * 4 + 3] = 255;
}
const layer: RasterLayer = {
  id: 'L', type: 'raster', name: 'L', x: 0, y: 0, width: SIZE, height: SIZE, pxWidth: SIZE, pxHeight: SIZE, visible: true, locked: false,
  rev: 0, opacity: 1, blend: 'normal', fx: [],
} as unknown as RasterLayer;

beforeEach(() => { vi.useFakeTimers(); reads.count = 0; });

describe('pointer-up does not scan the layer', () => {
  it('extends the known box with the stroke region instead of reading the canvas back', () => {
    const base = place(fakeCanvas(), { x0: 0, y0: 0, fw: SIZE, fh: SIZE });
    solid(base, 10, 10, 20, 20);
    setBuffer('L', base);
    expect(rasterPaintedBox(layer, true)).toEqual({ x: 10, y: 10, w: 10, h: 10 });
    expect(reads.count).toBe(1);

    const copy = beginEdit(layer);
    const live = beginLiveStroke(copy, '#000000', 1, false);
    paintLive(copy, live, { x: 100, y: 100 }, { x: 110, y: 104 }, 6, 1);
    reads.count = 0;
    commitEdit('L');

    const box = rasterPaintedBox(layer, true);
    expect(reads.count).toBe(0);
    expect(box).not.toBeUndefined();
    // Union of the old box (10..20) and the stroke's region around (100..110): it covers both.
    expect(box!.x).toBeLessThanOrEqual(10);
    expect(box!.y).toBeLessThanOrEqual(10);
    expect(box!.x + box!.w).toBeGreaterThanOrEqual(110);
    expect(box!.y + box!.h).toBeGreaterThanOrEqual(104);
  });

  it('measures again when the canvas was replaced during the stroke', () => {
    const base = place(fakeCanvas(), { x0: 0, y0: 0, fw: SIZE, fh: SIZE });
    solid(base, 10, 10, 20, 20);
    setBuffer('L', base);
    rasterPaintedBox(layer, true);
    beginEdit(layer);
    setBuffer('L', place(fakeCanvas(), { x0: 0, y0: 0, fw: SIZE, fh: SIZE }));
    reads.count = 0;
    commitEdit('L');
    rasterPaintedBox(layer, true);
    expect(reads.count).toBeGreaterThan(0);
  });
});

function fakeCanvas() {
  const c = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4), getContext: () => ({ getImageData: () => { reads.count++; return { data: c.data }; } }) };
  return c as unknown as HTMLCanvasElement & { data: Uint8ClampedArray };
}
void getRasterSurface; void pixelBox;
