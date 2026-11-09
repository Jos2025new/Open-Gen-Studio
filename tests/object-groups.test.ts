import { describe, expect, it } from 'vitest';
import type { VectorLayer, VectorShape } from '../src/engine/types';
import { clickPick, groupShapes, shapesSvgTree, ungroupShapes } from '../src/engine/design/objectGroupTree';

const shape = (id: string): VectorShape => ({ id, type: 'rect', x: 0, y: 0, w: 1, h: 1, fill: '#000', stroke: null, strokeWidth: 0 } as VectorShape);
const layer = (ids: string[]): VectorLayer => ({ id: 'L', name: 'L', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: ids.map(shape) } as unknown as VectorLayer);
const svg = (l: VectorLayer) => shapesSvgTree(l, (s) => `[${s.id}]`, (x) => x);

describe('object groups', () => {
  it('gathers members at the topmost one and keeps the rest in order', () => {
    const r = groupShapes(layer(['a', 'b', 'c', 'd']), ['a', 'c'])!;
    expect(r.layer.shapes.map((s) => s.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(svg(r.layer)).toBe(`[b]<g id="L-${r.groupId}" inkscape:label="Group 1">[a][c]</g>[d]`);
  });
  it('a click picks the outermost group; groups nest and ungroup one level', () => {
    const g1 = groupShapes(layer(['a', 'b', 'c']), ['a', 'b'])!;
    const g2 = groupShapes(g1.layer, ['a', 'c'])!;
    expect(clickPick(g2.layer, 'b').sort()).toEqual(['a', 'b', 'c']);
    expect(svg(g2.layer)).toBe(`<g id="L-${g2.groupId}" inkscape:label="Group 2"><g id="L-${g1.groupId}" inkscape:label="Group 1">[a][b]</g>[c]</g>`);
    const u = ungroupShapes(g2.layer, ['c'])!;
    expect(clickPick(u, 'a').sort()).toEqual(['a', 'b']);
    expect(clickPick(u, 'c')).toEqual(['c']);
  });
  it('needs two items', () => {
    expect(groupShapes(layer(['a', 'b']), ['a'])).toBeNull();
  });
});
