import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { transformLayer, transformObjects, transformShape } from '../src/engine/design/affine';
import { apply, invert, multiply, rotateAbout, scaleAbout, skewAbout, type Mat } from '../src/engine/design/matrix';
import { newRasterLayer, newVectorLayer, translateLayer } from '../src/engine/design/doc';
import { layerBox, toLayerSpace } from '../src/engine/design/render';
import type { RasterLayer, VectorLayer } from '../src/engine/types';

const rect = { id: 'r', type: 'rect' as const, x: 0, y: 0, w: 100, h: 50, fill: '#fff', stroke: null, strokeWidth: 2, radius: 0 };
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 4));

describe('matrices', () => {
  it('rotate, scale and skew about a point; inverse undoes', () => {
    close(apply(rotateAbout(Math.PI / 2, 0, 0), 10, 0), [0, 10]); // clockwise on screen (y down)
    close(apply(scaleAbout(2, 3, 10, 10), 20, 20), [30, 40]);
    close(apply(skewAbout(1, 0, 0, 0), 0, 10), [10, 10]);
    const m = multiply(rotateAbout(0.7, 5, 5), scaleAbout(2, 1, 0, 0));
    close(apply(invert(m), ...apply(m, 3, 4)), [3, 4]);
  });
});

describe('one transform for every kind of content', () => {
  it('a rectangle scaled stays a rectangle; rotated it becomes a path that sits where it turned', () => {
    const s = transformShape(rect, scaleAbout(2, 2, 0, 0));
    expect([s.type, s.w, s.h, s.strokeWidth]).toEqual(['rect', 200, 100, 4]);
    const r = transformShape(rect, rotateAbout(Math.PI / 2, 50, 25));
    expect(r.type).toBe('path');
    close([r.x, r.y, r.w, r.h], [25, -25, 50, 100]);
  });
  it('only the picked objects of a vector layer move', () => {
    const l = { ...newVectorLayer('v'), shapes: [rect, { ...rect, id: 'q', x: 300 }] } as VectorLayer;
    const t = transformObjects(l, ['q'], rotateAbout(Math.PI / 4, 350, 25)) as VectorLayer;
    expect(t.shapes[0]).toEqual(rect);
    expect(t.shapes[1].type).toBe('path');
  });
  it('an image keeps its pixels and gains a matrix; its box and hit mapping follow; moving it moves the matrix', () => {
    const img = newRasterLayer('img', { x: 0, y: 0, width: 100, height: 50 }, { width: 100, height: 50 }, 'asset1') as RasterLayer;
    const m: Mat = rotateAbout(Math.PI / 2, 50, 25);
    const t = transformLayer(img, null, m, {}, false) as RasterLayer;
    expect([t.x, t.y, t.width, t.height]).toEqual([0, 0, 100, 50]);
    const b = layerBox(t)!;
    close([b.x, b.y, b.w, b.h], [25, -25, 50, 100]);
    close(toLayerSpace(t, ...apply(m, 10, 20)), [10, 20]);
    const moved = translateLayer(t, 5, 0);
    close(apply(moved.transform!, 10, 20), [apply(m, 10, 20)[0] + 5, apply(m, 10, 20)[1]]);
  });
  it('painted strokes (buffer pixels) rotate with their width scaled', () => {
    const l = { ...newRasterLayer('p', { x: 0, y: 0, width: 100, height: 100 }, { width: 200, height: 200 }), paintBaseId: 'b', paintStrokes: [{ id: 's', x: 0, y: 0, segments: [[0, 0, 100, 0, 10]], color: '#fff', opacity: 1, erase: false }] } as RasterLayer;
    const t = transformObjects(l, ['s'], scaleAbout(2, 2, 0, 0)) as RasterLayer;
    expect(t.paintStrokes![0].segments[0]).toEqual([0, 0, 200, 0, 20]);
  });
});
