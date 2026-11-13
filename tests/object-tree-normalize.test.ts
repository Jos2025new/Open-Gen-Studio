import { describe, expect, it } from 'vitest';
import type { ObjectGroup, VectorLayer, VectorShape } from '../src/engine/types';
import { normalizeObjectTree, normalizeObjectTrees } from '../src/engine/design/objectTreeNormalize';
import { shapesSvgTree } from '../src/engine/design/objectGroupTree';

/*
 * The tree every reader relies on is put back without changing what is drawn: same shapes in the same order.
 */
const shape = (id: string, groupId?: string): VectorShape => ({ id, groupId, type: 'rect', x: 0, y: 0, w: 1, h: 1, radius: 0, fill: '#000', stroke: null, strokeWidth: 0 } as VectorShape);
const layer = (shapes: VectorShape[], objectGroups?: ObjectGroup[]): VectorLayer => ({ id: 'L', name: 'L', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes, objectGroups } as unknown as VectorLayer);
const tree = (l: VectorLayer) => shapesSvgTree(l, (s) => `<${s.id}/>`, (x) => x).replace(/ id="[^"]*"/g, '').replace(/ inkscape:label="([^"]*)"/g, ' $1');

describe('normalizeObjectTree', () => {
  it('a layer that holds comes back as the same object', () => {
    const plain = layer([shape('a'), shape('b')]);
    const nested = layer([shape('a', 'in'), shape('b', 'in'), shape('c', 'out'), shape('d')], [{ id: 'out', name: 'Out' }, { id: 'in', name: 'In', parentId: 'out' }]);
    expect(normalizeObjectTree(plain)).toBe(plain);
    expect(normalizeObjectTree(nested)).toBe(nested);
    const doc = { layers: [plain, nested] } as never;
    expect(normalizeObjectTrees(doc)).toBe(doc);
  });
  it('a groupId or parentId that names no group is dropped; an empty group goes', () => {
    const l = normalizeObjectTree(layer([shape('a', 'gone'), shape('b', 'g')], [{ id: 'g', name: 'G', parentId: 'nowhere' }, { id: 'empty', name: 'E' }]));
    expect(l.shapes.map((s) => s.groupId)).toEqual([undefined, 'g']);
    expect(l.objectGroups).toEqual([{ id: 'g', name: 'G', parentId: undefined }]);
    expect(normalizeObjectTree(layer([shape('a', 'gone')])).objectGroups).toBeUndefined();
  });
  it('a group that is its own ancestor is cut where the circle closes', () => {
    const l = normalizeObjectTree(layer([shape('a', 'x'), shape('b', 'y')], [{ id: 'x', name: 'X', parentId: 'y' }, { id: 'y', name: 'Y', parentId: 'x' }]));
    const byId = new Map(l.objectGroups!.map((g) => [g.id, g]));
    for (const g of l.objectGroups!) { const seen = new Set<string>(); for (let c: ObjectGroup | undefined = g; c; c = c.parentId ? byId.get(c.parentId) : undefined) { expect(seen.has(c.id)).toBe(false); seen.add(c.id); } }
    expect(l.shapes.map((s) => s.id)).toEqual(['a', 'b']);
    expect(normalizeObjectTree(l)).toBe(l);
  });
  it('a group split by another shape continues as a copy with its name and look: order kept, every <g> opened once', () => {
    const before = layer([shape('a', 'g'), shape('x'), shape('b', 'g'), shape('c', 'in'), shape('y', 'other'), shape('d', 'in')],
      [{ id: 'g', name: 'G', opacity: 0.5, blend: 'multiply' }, { id: 'in', name: 'In', parentId: 'g' }, { id: 'other', name: 'Other' }]);
    const l = normalizeObjectTree(before);
    expect(l.shapes.map((s) => s.id)).toEqual(['a', 'x', 'b', 'c', 'y', 'd']);
    expect(tree(l)).toBe('<g G opacity="0.5" style="mix-blend-mode:multiply"><a/></g><x/><g G opacity="0.5" style="mix-blend-mode:multiply"><b/><g In><c/></g></g><g Other><y/></g><g G opacity="0.5" style="mix-blend-mode:multiply"><g In><d/></g></g>');
    expect(new Set(l.objectGroups!.map((g) => g.id)).size).toBe(l.objectGroups!.length);
    expect(l.objectGroups).toHaveLength(6);
    expect(normalizeObjectTree(l)).toBe(l);
  });
});
