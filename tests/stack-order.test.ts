import { describe, expect, it } from 'vitest';
import type { DesignDoc, Layer, VectorLayer, VectorShape } from '../src/engine/types';
import { groupShapes, shapesSvgTree } from '../src/engine/design/objectGroupTree';
import { restack, restackLayers, restackPicks, restackShapes } from '../src/engine/design/stackOrder';

const shape = (id: string): VectorShape => ({ id, type: 'rect', x: 0, y: 0, w: 1, h: 1, fill: '#000', stroke: null, strokeWidth: 0 } as VectorShape);
const layer = (ids: string[], id = 'L'): VectorLayer => ({ id, name: id, type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: ids.map(shape) } as unknown as VectorLayer);
const order = (l: VectorLayer | null) => l?.shapes.map((s) => s.id).join('');
const tree = (l: VectorLayer) => shapesSvgTree(l, (s) => s.id, (x) => x).replace(/<g[^>]*>/g, '(').replace(/<\/g>/g, ')');

describe('stacking order', () => {
  it('moves the picked items one step or to an end, keeping their own order', () => {
    const pick = (t: string) => t === 'b' || t === 'c';
    expect(restack(['a', 'b', 'c', 'd', 'e'], pick, 'forward').join('')).toBe('adbce');
    expect(restack(['a', 'b', 'c', 'd', 'e'], pick, 'backward').join('')).toBe('bcade');
    expect(restack(['a', 'b', 'c', 'd', 'e'], pick, 'front').join('')).toBe('adebc');
    expect(restack(['a', 'b', 'c', 'd', 'e'], pick, 'back').join('')).toBe('bcade');
    expect(restack(['a', 'b', 'c'], (t) => t !== 'a', 'forward').join('')).toBe('abc');
  });
  it('reorders shapes inside their layer; nothing to move is null', () => {
    expect(order(restackShapes(layer(['a', 'b', 'c']), ['a'], 'front'))).toBe('bca');
    expect(order(restackShapes(layer(['a', 'b', 'c']), ['c'], 'backward'))).toBe('acb');
    expect(restackShapes(layer(['a', 'b', 'c']), ['c'], 'front')).toBeNull();
  });
  it('a whole group moves as one block and a shape jumps over a whole group', () => {
    const g = groupShapes(layer(['a', 'b', 'c', 'd']), ['b', 'c'])!.layer;
    expect(tree(g)).toBe('a(bc)d');
    expect(tree(restackShapes(g, ['b', 'c'], 'backward')!)).toBe('(bc)ad');
    expect(tree(restackShapes(g, ['b', 'c'], 'front')!)).toBe('ad(bc)');
    expect(tree(restackShapes(g, ['a'], 'forward')!)).toBe('(bc)ad');
  });
  it('a member picked inside a group moves among its siblings and never leaves the group', () => {
    const g = groupShapes(layer(['a', 'b', 'c', 'd']), ['a', 'b', 'c'])!.layer;
    expect(tree(restackShapes(g, ['a'], 'front')!)).toBe('(bca)d');
    expect(restackShapes(g, ['c'], 'front')).toBeNull();
  });
  it('members of a group that are not together (older files) are not shuffled by a move that changes nothing', () => {
    const l = { ...layer(['a', 'x', 'b']), objectGroups: [{ id: 'g', name: 'G' }] } as VectorLayer;
    l.shapes = l.shapes.map((s) => (s.id === 'x' ? s : { ...s, groupId: 'g' }));
    expect(restackShapes(l, ['x'], 'front')).toBeNull();
    expect(restackShapes(l, ['a', 'b'], 'back')).toBeNull();
  });
  it('Objects mode: shapes stay in their layer; an image picked as an object moves its layer', () => {
    const img = { id: 'I', name: 'I', type: 'raster', visible: true, locked: false } as unknown as Layer;
    const doc = { id: 'D', layers: [img, layer(['a', 'b'], 'V')] } as unknown as DesignDoc;
    expect(restackPicks(doc, [{ layerId: 'V', ids: ['b'] }, { layerId: 'I', ids: ['I'] }], 'backward')!.layers.map((l) => l.id)).toEqual(['I', 'V']);
    expect(restackPicks(doc, [{ layerId: 'V', ids: ['b'] }], 'front')).toBeNull();
    const mix = restackPicks(doc, [{ layerId: 'V', ids: ['a'] }, { layerId: 'I', ids: ['I'] }], 'front')!;
    expect(mix.layers.map((l) => l.id)).toEqual(['V', 'I']);
    expect(order(mix.layers[0] as VectorLayer)).toBe('ba');
  });
  it('Layers mode moves layers', () => {
    const doc = { id: 'D', layers: [layer([], 'A'), layer([], 'B'), layer([], 'C')] } as unknown as DesignDoc;
    expect(restackLayers(doc, ['A'], 'forward')!.layers.map((l) => l.id)).toEqual(['B', 'A', 'C']);
    expect(restackLayers(doc, ['C'], 'front')).toBeNull();
  });
});
