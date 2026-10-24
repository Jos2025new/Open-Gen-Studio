import { describe, expect, it } from 'vitest';
import type { DesignDoc, Layer } from '../src/engine/types';
import { marqueeFind } from '../src/engine/design/marqueePick';

const vec = (id: string, x: number, y: number, w = 20, h = 20): Layer => ({
  id, type: 'vector', name: id, visible: true, locked: false, opacity: 1, blend: 'normal',
  shapes: [{ id: `${id}-s`, type: 'rect', x, y, w, h, fill: '#fff', stroke: null, strokeWidth: 0, radius: 0 }], strokes: [],
} as unknown as Layer);
const raster = (id: string): Layer => ({ id, type: 'raster', name: id, visible: true, locked: false, opacity: 1, blend: 'normal', x: 0, y: 0, width: 200, height: 200, paintStrokes: [] } as unknown as Layer);
const doc = (layers: Layer[]) => ({ id: 'd', layers, activeLayerId: layers[0]?.id ?? null } as unknown as DesignDoc);

describe('Edit marquee finds what it touches', () => {
  it('selects a shape the rectangle only crosses, not just encloses', () => {
    const f = marqueeFind(doc([vec('a', 40, 40)]), 0, 0, 50, 50);
    expect(f.layers).toEqual(['a']);
    expect(f.objects.get('a')).toEqual(['a-s']);
  });
  it('ignores shapes outside, hidden and locked layers', () => {
    const hidden = { ...vec('h', 10, 10), visible: false } as Layer, locked = { ...vec('l', 10, 10), locked: true } as Layer;
    expect(marqueeFind(doc([vec('far', 150, 150), hidden, locked]), 0, 0, 50, 50).layers).toEqual([]);
  });
  it('a raster layer without objects is found by its painted pixels, not by its (page-sized) box', () => {
    const d = doc([raster('r')]);
    expect(marqueeFind(d, 0, 0, 50, 50, () => true).layers).toEqual(['r']);
    expect(marqueeFind(d, 0, 0, 50, 50, () => false).layers).toEqual([]);
  });
  it('reports several layers at once', () => {
    const f = marqueeFind(doc([raster('r'), vec('a', 10, 10)]), 0, 0, 50, 50, () => true);
    expect(f.layers.sort()).toEqual(['a', 'r']);
  });
});
