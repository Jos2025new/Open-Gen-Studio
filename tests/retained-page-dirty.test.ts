import { describe, expect, it } from 'vitest';
import { rasterDirtyRect } from '../src/engine/design/rasterDirty';
import { rasterPaintedBox } from '../src/engine/design/rasterBounds';
import { setBuffer } from '../src/engine/design/raster';
import { place } from '../src/engine/design/rasterSurface';
/** A test canvas injected as a full buffer: placed at (0, 0) over its whole size, so it is stored as it is. */
const setFull = (id: string, c: { width: number; height: number }, persist?: boolean, dirty?: Parameters<typeof setBuffer>[3]) => setBuffer(id, place(c as HTMLCanvasElement, { x0: 0, y0: 0, fw: c.width, fh: c.height }), persist, dirty);

import type { RasterLayer } from '../src/engine/types';

const canvas = (width: number, height: number) => ({ width, height }) as HTMLCanvasElement;
function paintedCanvas(width: number, height: number, boxes: { x0: number; y0: number; x1: number; y1: number } | { x0: number; y0: number; x1: number; y1: number }[], reads: { count: number }): HTMLCanvasElement {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const box of Array.isArray(boxes) ? boxes : [boxes]) {
    for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) data[(y * width + x) * 4 + 3] = 255;
  }
  return { width, height, getContext: () => ({ getImageData: () => { reads.count++; return { data }; } }) } as unknown as HTMLCanvasElement;
}
const layer = (id: string, paintBaseId?: string): RasterLayer => ({
  id, name: id, type: 'raster', visible: true, locked: false, opacity: 1, blend: 'normal',
  x: 0, y: 0, width: 100, height: 100, pxWidth: 100, pxHeight: 100, rev: 1, paintBaseId, paintStrokes: [],
});

describe('retained raster dirty area', () => {
  it('consumes paint-base initialization without treating it as visible pixels', () => {
    const l = layer('retained-dirty-base', 'retained-dirty-base-id');
    setFull(l.id, canvas(100, 100), false, { x0: 10, y0: 12, x1: 16, y1: 20 });
    setFull(l.paintBaseId!, canvas(100, 100), false);

    expect(rasterDirtyRect(l, 1)).toEqual({ x0: 10, y0: 12, x1: 16, y1: 20 });
    expect(rasterDirtyRect(l, 1)).toBeNull();
  });

  it('ignores a base-only clone while still consuming its dirty record', () => {
    const l = layer('retained-base-only', 'retained-base-only-id');
    setFull(l.paintBaseId!, canvas(100, 100), false);

    expect(rasterDirtyRect(l, 1)).toBeNull();
    expect(rasterDirtyRect(l, 1)).toBeNull();
  });

  it('extends cached total bounds with localized writes without reading the replacement canvas', () => {
    const l = layer('retained-bounds-union'), reads = { count: 0 };
    setFull(l.id, paintedCanvas(100, 100, { x0: 1, y0: 2, x1: 3, y1: 4 }, reads), false);
    expect(rasterPaintedBox(l)).toEqual({ x: 1, y: 2, w: 2, h: 2 });
    expect(rasterDirtyRect(l, 1)).toEqual({ x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(rasterPaintedBox(l)).toEqual({ x: 1, y: 2, w: 2, h: 2 });
    const changed = paintedCanvas(100, 100, [{ x0: 1, y0: 2, x1: 3, y1: 4 }, { x0: 50, y0: 51, x1: 55, y1: 57 }], reads);
    setFull(l.id, changed, false, { x0: 50, y0: 51, x1: 55, y1: 57 });
    expect(rasterDirtyRect(l, 1)).toEqual({ x0: 50, y0: 51, x1: 55, y1: 57 });
    expect(rasterPaintedBox(l)).toEqual({ x: 1, y: 2, w: 54, h: 55 });
    expect(reads.count).toBe(2);
  });

  it('rechecks a conservative full-dirty placement bound when an idle exact pixel box is requested', () => {
    const l = layer('retained-full-dirty'), reads = { count: 0 };
    setFull(l.id, paintedCanvas(100, 100, { x0: 11, y0: 17, x1: 20, y1: 26 }, reads), false, 'all');

    expect(rasterDirtyRect(l, 1)).toEqual({ x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(rasterPaintedBox(l, false)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(reads.count).toBe(0);

    expect(rasterPaintedBox(l)).toEqual({ x: 11, y: 17, w: 9, h: 9 });
    expect(reads.count).toBe(1);
  });
});
