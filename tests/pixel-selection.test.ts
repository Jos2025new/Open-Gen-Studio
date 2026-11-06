import { describe, expect, it } from 'vitest';
import { getSelection, invertSelection, rectPoints, selectAll, selectionBox, setSelection } from '../src/engine/design/pixelSelection';

const doc = { id: 'd1', width: 100, height: 80 } as Parameters<typeof selectAll>[0];

describe('pixel selection', () => {
  it('box is clamped to the page; inverted means the whole page; fewer than 3 points is no selection', () => {
    expect(selectionBox(doc, { points: rectPoints(-10, 10.4, 50.2, 200) })).toEqual({ x: 0, y: 10, w: 51, h: 70 });
    expect(selectionBox(doc, { points: rectPoints(10, 10, 20, 20), inverted: true })).toEqual({ x: 0, y: 0, w: 100, h: 80 });
    setSelection('d1', { points: [[0, 0], [1, 1]] });
    expect(getSelection('d1')).toBeNull();
  });
  it('select all, invert twice, deselect', () => {
    selectAll(doc);
    expect(selectionBox(doc, getSelection('d1')!)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
    invertSelection(doc);
    expect(getSelection('d1')!.inverted).toBe(true);
    invertSelection(doc);
    expect(getSelection('d1')!.inverted).toBe(false);
    setSelection('d1', null);
    expect(getSelection('d1')).toBeNull();
  });
});

import { floodMask } from '../src/engine/design/fill';

describe('magic wand region (shared with the bucket)', () => {
  // 5×1 strip: two reds, a near red, then blue twice. Opaque.
  const px = (rgb: number[][]) => new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));
  const strip = px([[200, 0, 0], [200, 0, 0], [180, 0, 0], [0, 0, 200], [0, 0, 200]]);
  it('tolerance decides how wide a range of colors is picked', () => {
    expect([...floodMask(strip, 5, 1, 0, 0, 10, 0)]).toEqual([1, 1, 0, 0, 0]);
    expect([...floodMask(strip, 5, 1, 0, 0, 30, 0)]).toEqual([1, 1, 1, 0, 0]);
  });
  it('expand grows the region by whole pixels', () => {
    expect([...floodMask(strip, 5, 1, 0, 0, 10, 1)]).toEqual([1, 1, 1, 0, 0]);
    expect([...floodMask(strip, 5, 1, 0, 0, 10, 2)]).toEqual([1, 1, 1, 1, 0]);
  });
  it('only contiguous pixels: the same color past a gap is not picked', () => {
    const gap = px([[200, 0, 0], [0, 0, 200], [200, 0, 0]]);
    expect([...floodMask(gap, 3, 1, 0, 0, 10, 0)]).toEqual([1, 0, 0]);
  });
});

import { vi } from 'vitest';
import { combineSelection } from '../src/engine/design/pixelSelection';
import * as media from '../src/lib/media';

describe('combining selections: intersect', () => {
  const mask = () => ({ width: 4, height: 1 } as HTMLCanvasElement);
  const d = { id: 'd2', width: 4, height: 1 } as Parameters<typeof selectAll>[0];
  const fakeOps = () => {
    const ops: string[] = [];
    const ctx = {
      globalCompositeOperation: 'source-over',
      drawImage() { ops.push(this.globalCompositeOperation); },
      // Everything on, so the combined mask is not empty.
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
    };
    vi.spyOn(media, 'createCanvas').mockImplementation((w, h) => ({ width: w, height: h } as HTMLCanvasElement));
    vi.spyOn(media, 'ctx2d').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    return ops;
  };
  it('keeps what both cover (destination-in); without a selection it replaces; no shape clears', () => {
    const ops = fakeOps();
    setSelection('d2', { points: [], mask: mask() });
    combineSelection(d, { points: [], mask: mask() }, 'intersect');
    expect(ops).toEqual(['source-over', 'destination-in']);
    expect(getSelection('d2')?.mask).toBeDefined();
    combineSelection(d, null, 'intersect');
    expect(getSelection('d2')).toBeNull();
    const next = { points: [], mask: mask() };
    combineSelection(d, next, 'intersect');
    expect(getSelection('d2')).toBe(next);
    vi.restoreAllMocks();
  });
});
