import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ sheet: new Uint8ClampedArray(0), rects: [] as unknown[], origins: [] as string[], reason: '' }));
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
vi.mock('../src/lib/media', () => ({
  createCanvas: (w: number, hh: number) => ({ width: w, height: hh }),
  ctx2d: () => ({ translate() {}, getImageData: () => ({ data: h.sheet }) }),
}));
vi.mock('../src/engine/design/render', () => ({ drawDoc: (_c: unknown, _d: unknown, o: { origin: string }) => { h.origins.push(o.origin); } }));
vi.mock('../src/engine/design/framePeek', () => ({ peekPixel: () => undefined }));
vi.mock('../src/engine/design/sampleSource', () => ({
  renderSource: (_d: unknown, source: string, o: { origin: string; rect: unknown }) => { h.origins.push(`${source}:${o.origin}`); h.rects.push(o.rect); return h.reason || { canvas: {} }; },
}));

import { averageColor, clampRadius, sampleColor } from '../src/engine/design/swatches';
import type { DesignDoc } from '../src/engine/types';

const doc = { width: 10, height: 10 } as DesignDoc;
const px = (...p: number[][]) => new Uint8ClampedArray(p.flat());

describe('averageColor', () => {
  it('averages a window, weighted by alpha so transparent pixels do not darken', () => {
    const data = px([200, 100, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(averageColor(data, 2, 2, 0, 0, 1)).toBe('#c86400');
    const two = px([200, 0, 0, 255], [0, 0, 200, 255]);
    expect(averageColor(two, 2, 1, 0, 0, 1)).toBe('#640064');
  });
  it('radius 0 is the single pixel; all transparent is null; the window is cut at the sheet edge', () => {
    const data = px([10, 20, 30, 255], [90, 90, 90, 255]);
    expect(averageColor(data, 2, 1, 0, 0, 0)).toBe('#0a141e');
    expect(averageColor(px([5, 5, 5, 0]), 1, 1, 0, 0, 3)).toBeNull();
    expect(averageColor(data, 2, 1, 1, 0, 5)).toBe('#32373c');
  });
});

describe('sampleColor options', () => {
  it('radius is clamped to 0..15, junk is 0', () => {
    expect([clampRadius(40), clampRadius(-3), clampRadius(NaN), clampRadius('x'), clampRadius(2.4)]).toEqual([15, 0, 0, 0, 2]);
  });
  it('without options: composes one pixel with the literal origin, as before', () => {
    h.origins = []; h.sheet = px([1, 2, 3, 255]);
    expect(sampleColor(doc, 4, 4)).toBe('#010203');
    expect(h.origins).toEqual(['color-sample']);
  });
  it('a radius reads a window cut at the page edge, through the shared source', () => {
    h.origins = []; h.rects = []; h.sheet = new Uint8ClampedArray(4 * 4 * 4).fill(100);
    expect(sampleColor(doc, 1, 1, { radius: 2 })).toBe('#646464');
    expect(h.rects).toEqual([{ x: 0, y: 0, w: 4, h: 4 }]);
    expect(h.origins).toEqual(['all:color-sample']);
  });
  it('layer source reads the layer even for one pixel; a failing source reports why and gives null', () => {
    h.origins = []; h.rects = []; h.sheet = px([9, 9, 9, 255]);
    expect(sampleColor(doc, 3, 3, { source: 'layer' })).toBe('#090909');
    expect(h.rects).toEqual([{ x: 3, y: 3, w: 1, h: 1 }]);
    h.reason = 'Select a layer first, or sample all layers.';
    const why = vi.fn();
    expect(sampleColor(doc, 3, 3, { source: 'layer', onReason: why })).toBeNull();
    expect(why).toHaveBeenCalledWith(h.reason);
    h.reason = '';
  });
  it('outside the page is null', () => {
    expect(sampleColor(doc, -1, 2, { radius: 3 })).toBeNull();
    expect(sampleColor(doc, 10, 2)).toBeNull();
  });
});
