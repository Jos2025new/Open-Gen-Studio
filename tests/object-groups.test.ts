import { describe, expect, it } from 'vitest';
import type { DesignDoc, Layer, VectorLayer, VectorShape } from '../src/engine/types';
import { groupAcrossLayers } from '../src/engine/design/groupAcross';
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
    const g2 = groupShapes(g1.layer, ['a', 'b', 'c'])!;
    expect(clickPick(g2.layer, 'b').sort()).toEqual(['a', 'b', 'c']);
    expect(svg(g2.layer)).toBe(`<g id="L-${g2.groupId}" inkscape:label="Group 2"><g id="L-${g1.groupId}" inkscape:label="Group 1">[a][b]</g>[c]</g>`);
    const u = ungroupShapes(g2.layer, ['c'])!;
    expect(clickPick(u, 'a').sort()).toEqual(['a', 'b']);
    expect(clickPick(u, 'c')).toEqual(['c']);
  });
  it('needs two items', () => {
    expect(groupShapes(layer(['a', 'b']), ['a'])).toBeNull();
  });
  it('a member picked from inside a group leaves it alone; the old group keeps the rest', () => {
    const g1 = groupShapes(layer(['a', 'b', 'c', 'd']), ['a', 'b', 'c'])!;
    const g2 = groupShapes(g1.layer, ['c', 'd'])!;
    expect(svg(g2.layer)).toBe(`<g id="L-${g1.groupId}" inkscape:label="Group 1">[a][b]</g><g id="L-${g2.groupId}" inkscape:label="Group 2">[c][d]</g>`);
    expect(g2.layer.objectGroups!.find((g) => g.id === g2.groupId)!.parentId).toBeUndefined();
    // The topmost pick decides the place: a member on top takes the loose shape into its own group.
    const low = groupShapes(layer(['x', 'a', 'b']), ['a', 'b'])!;
    const inner = groupShapes(low.layer, ['x', 'b'])!;
    expect(svg(inner.layer)).toBe(`<g id="L-${low.groupId}" inkscape:label="Group 1">[a]<g id="L-${inner.groupId}" inkscape:label="Group 2">[x][b]</g></g>`);
  });
  it('a group left with one member is still a whole group when that member is picked', () => {
    const g1 = groupShapes(layer(['a', 'b', 'c', 'd']), ['a', 'b'])!;
    const g2 = groupShapes(g1.layer, ['a', 'c'])!;
    const g3 = groupShapes(g2.layer, ['b', 'd'])!;
    expect(g3.layer.objectGroups!.find((g) => g.id === g1.groupId)!.parentId).toBe(g3.groupId);
  });
  it('a whole group goes in as a subgroup', () => {
    const g1 = groupShapes(layer(['a', 'b', 'c']), ['a', 'b'])!;
    const g2 = groupShapes(g1.layer, ['a', 'b', 'c'])!;
    expect(g2.layer.objectGroups!.find((g) => g.id === g1.groupId)!.parentId).toBe(g2.groupId);
    expect(g2.layer.shapes.find((s) => s.id === 'a')!.groupId).toBe(g1.groupId);
  });
  it('mix: a whole group, a member taken from another group and a loose shape', () => {
    const g1 = groupShapes(layer(['a', 'b', 'c', 'd', 'e']), ['a', 'b'])!;
    const g2 = groupShapes(g1.layer, ['c', 'd'])!;
    const g3 = groupShapes(g2.layer, ['a', 'b', 'c', 'e'])!;
    expect(svg(g3.layer)).toBe(`<g id="L-${g2.groupId}" inkscape:label="Group 2">[d]</g><g id="L-${g3.groupId}" inkscape:label="Group 3"><g id="L-${g1.groupId}" inkscape:label="Group 1">[a][b]</g>[c][e]</g>`);
  });
  it('two members picked inside a group make a subgroup there', () => {
    const g1 = groupShapes(layer(['a', 'b', 'c']), ['a', 'b', 'c'])!;
    const g2 = groupShapes(g1.layer, ['a', 'b'])!;
    expect(svg(g2.layer)).toBe(`<g id="L-${g1.groupId}" inkscape:label="Group 1"><g id="L-${g2.groupId}" inkscape:label="Group 2">[a][b]</g>[c]</g>`);
  });
});

const doc = (layers: Layer[]): DesignDoc => ({ id: 'D', name: 'D', width: 100, height: 100, layers, activeLayerId: layers[0].id } as unknown as DesignDoc);
const named = (id: string, ids: string[], extra: Partial<VectorLayer> = {}): VectorLayer => ({ ...layer(ids), id, name: id, ...extra });
const across = (d: DesignDoc, picks: Array<{ layerId: string; ids: string[] }>) => { const r = groupAcrossLayers(d, picks); if (!r || 'error' in r) throw new Error(r?.error ?? 'not grouped'); return r; };
const refused = (d: DesignDoc, picks: Array<{ layerId: string; ids: string[] }>) => { const r = groupAcrossLayers(d, picks); return r && 'error' in r ? r.error : null; };
const AC = [{ layerId: 'L1', ids: ['a'] }, { layerId: 'L3', ids: ['c'] }];

describe('grouping across layers', () => {
  it('moves the picked shapes to the topmost one\'s layer, in order, and keeps the layers left empty', () => {
    const d = doc([named('L1', ['a']), named('L2', ['b', 'x']), named('L3', ['y', 'c'])]);
    const r = across(d, [{ layerId: 'L3', ids: ['c'] }, { layerId: 'L1', ids: ['a'] }, { layerId: 'L2', ids: ['b'] }]);
    // The layer left empty stays, as in Inkscape and Illustrator.
    expect(r.doc.layers.map((l) => l.id)).toEqual(['L1', 'L2', 'L3']);
    expect((r.doc.layers[0] as VectorLayer).shapes).toEqual([]);
    expect((r.doc.layers[1] as VectorLayer).shapes.map((s) => s.id)).toEqual(['x']);
    const top = r.doc.layers[2] as VectorLayer;
    expect(r.layerId).toBe('L3');
    expect(top.shapes.map((s) => s.id)).toEqual(['y', 'a', 'b', 'c']);
    expect(r.ids).toEqual(['a', 'b', 'c']);
    expect(top.shapes.filter((s) => s.groupId === r.groupId).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(r.doc.activeLayerId).toBe('L3');
    // The shapes themselves are untouched: same look, same place.
    expect(top.shapes.find((s) => s.id === 'a')).toEqual({ ...(d.layers[0] as VectorLayer).shapes[0], groupId: r.groupId });
  });
  it('a whole group of another layer travels as a subgroup; a member alone leaves its group behind', () => {
    const g = groupShapes(named('L1', ['a', 'b', 'k']), ['a', 'b'])!;
    const d = doc([g.layer, named('L2', ['c'])]);
    const whole = across(d, [{ layerId: 'L1', ids: ['a', 'b'] }, { layerId: 'L2', ids: ['c'] }]);
    const top = whole.doc.layers[1] as VectorLayer;
    expect(top.objectGroups!.find((x) => x.id === g.groupId)!.parentId).toBe(whole.groupId);
    expect((whole.doc.layers[0] as VectorLayer).objectGroups).toBeUndefined();
    const one = across(d, [{ layerId: 'L1', ids: ['a'] }, { layerId: 'L2', ids: ['c'] }]);
    expect((one.doc.layers[0] as VectorLayer).shapes.map((s) => [s.id, s.groupId])).toEqual([['b', g.groupId], ['k', undefined]]);
    expect((one.doc.layers[1] as VectorLayer).shapes.map((s) => s.groupId)).toEqual([one.groupId, one.groupId]);
  });
  it('keeps the look: the shapes of a layer with its own opacity, blend or hidden state go in a subgroup that carries it', () => {
    const d = doc([named('L1', ['a', 'k'], { opacity: 0.5, blend: 'multiply' }), named('L2', ['b'], { visible: false }), named('L3', ['c'])]);
    const r = across(d, [{ layerId: 'L1', ids: ['a'] }, { layerId: 'L2', ids: ['b'] }, { layerId: 'L3', ids: ['c'] }]);
    const top = r.doc.layers[2] as VectorLayer, group = (id: string) => top.objectGroups!.find((g) => g.id === top.shapes.find((s) => s.id === id)!.groupId)!;
    expect(top.shapes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(group('a')).toMatchObject({ name: 'L1', opacity: 0.5, blend: 'multiply', parentId: r.groupId });
    expect(group('b')).toMatchObject({ name: 'L2', hidden: true, parentId: r.groupId });
    expect(group('b').opacity).toBeUndefined();
    expect(top.shapes.find((s) => s.id === 'c')!.groupId).toBe(r.groupId);
    // The shapes keep their own values; the layers keep theirs.
    expect(top.shapes.find((s) => s.id === 'a')!.fillOpacity).toBeUndefined();
    expect(r.doc.layers[0]).toMatchObject({ opacity: 0.5, blend: 'multiply' });
    expect(top).toMatchObject({ opacity: 1, blend: 'normal' });
  });
  it('a top layer with its own look gives it to a subgroup when everything it draws is picked, and becomes plain', () => {
    const d = doc([named('L1', ['a']), named('L3', ['c'], { opacity: 0.4, blend: 'screen' })]);
    const r = across(d, AC);
    const top = r.doc.layers[1] as VectorLayer;
    expect(top).toMatchObject({ opacity: 1, blend: 'normal' });
    expect(top.objectGroups!.find((g) => g.id === top.shapes.find((s) => s.id === 'c')!.groupId)).toMatchObject({ opacity: 0.4, blend: 'screen', parentId: r.groupId });
    expect(top.shapes.find((s) => s.id === 'a')!.groupId).toBe(r.groupId);
  });
  it('stops, with the reason, only for what a group cannot carry', () => {
    expect(refused(doc([named('L1', ['a']), named('L3', ['c', 'more'], { opacity: 0.4 })]), AC)).toMatch(/top layer "L3" has its own opacity/);
    expect(refused(doc([named('L1', ['a']), named('L3', ['c'], { visible: false })]), AC)).toMatch(/hidden/);
    expect(refused(doc([named('L1', ['a'], { pixelMask: { id: 'm' } } as never), named('L3', ['c'])]), AC)).toMatch(/pixel mask/);
    const fx = (scope: string) => ({ id: 'FX', name: 'Glow', type: 'fx', scope, visible: true, locked: false, opacity: 1, blend: 'normal' } as unknown as Layer);
    expect(refused(doc([named('L1', ['a']), fx('below'), named('L3', ['c'])]), AC)).toMatch(/effects layer "Glow"/);
    // Effects clipped to the top layer would reach the shapes that come in.
    expect(refused(doc([named('L1', ['a']), named('L3', ['c']), fx('layer')]), AC)).toMatch(/effects layer "Glow"/);
    // Effects over everything reach them before and after alike.
    expect(refused(doc([named('L1', ['a']), named('L3', ['c']), fx('below')]), AC)).toBeNull();
    // Inside one layer nothing of that matters.
    expect(groupAcrossLayers(doc([named('L1', ['a', 'b'], { opacity: 0.5, blend: 'multiply' })]), [{ layerId: 'L1', ids: ['a', 'b'] }])).toHaveProperty('groupId');
  });
  it('a locked layer in the pick stops the group with a reason, never silently', () => {
    const d = doc([named('L1', ['a']), named('L2', ['b'], { locked: true }), named('L3', ['c'])]);
    expect(refused(d, [{ layerId: 'L1', ids: ['a'] }, { layerId: 'L2', ids: ['b'] }, { layerId: 'L3', ids: ['c'] }])).toMatch(/locked/);
  });
  it('one shape is not a group', () => {
    expect(groupAcrossLayers(doc([named('L1', ['a']), named('L2', ['b'])]), [{ layerId: 'L1', ids: ['a'] }])).toBeNull();
  });
});
