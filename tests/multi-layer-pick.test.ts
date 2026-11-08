import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignDoc, VectorLayer, VectorShape } from '../src/engine/types';

const fx = vi.hoisted(() => ({ doc: null as unknown as DesignDoc, records: 0 }));
vi.mock('../src/store/store', () => ({ toast: () => undefined, setDoc: (_s: string, _d: string, fn: (d: DesignDoc) => DesignDoc) => { fx.doc = fn(fx.doc); }, useStore: { getState: () => ({ sessions: { s: { docs: [fx.doc] } } }) } }));
vi.mock('../src/engine/design/actions', () => ({
  getDoc: () => fx.doc,
  mutateDoc: (_s: string, _d: string, fn: (d: DesignDoc) => DesignDoc) => { fx.records++; fx.doc = fn(fx.doc); },
}));
vi.mock('../src/engine/design/history', () => ({ record: () => { fx.records++; } }));

import { isPicked, objectPicks, pickObject, setObjectPicks, onlyPick } from '../src/engine/design/objectSelection';
import { patchPickedShapes, deletePicks, alignPicks } from '../src/engine/design/multiObjectOps';
import { findShapesByLook } from '../src/engine/design/shapeSameLook';

const shape = (id: string, over: Partial<VectorShape> = {}, x = 0): VectorShape => ({ id, type: 'rect', x, y: 0, w: 10, h: 10, fill: null, stroke: '#000', strokeWidth: 2, radius: 0, ...over } as VectorShape);
const layer = (id: string, shapes: VectorShape[], over: Partial<VectorLayer> = {}): VectorLayer => ({ id, type: 'vector', name: id, visible: true, locked: false, opacity: 1, blend: 'normal', shapes, ...over } as VectorLayer);
const mk = (layers: VectorLayer[]): DesignDoc => ({ id: 'd', width: 100, height: 100, layers, activeLayerId: layers[0]?.id ?? null } as unknown as DesignDoc);

beforeEach(() => { setObjectPicks('d', null); fx.records = 0; fx.doc = mk([layer('A', [shape('a1'), shape('a2', {}, 20)]), layer('B', [shape('b1', {}, 30)])]); });

describe('object pick across layers', () => {
  it('Ctrl-click adds an object of another layer, a second one removes it, a plain click starts over', () => {
    pickObject('d', 'A', 'a1', false);
    pickObject('d', 'B', 'b1', true);
    pickObject('d', 'A', 'a2', true);
    expect(objectPicks('d')).toEqual([{ layerId: 'A', ids: ['a1', 'a2'] }, { layerId: 'B', ids: ['b1'] }]);
    expect(onlyPick(objectPicks('d'))).toBeNull();
    pickObject('d', 'B', 'b1', true);
    expect(objectPicks('d')).toEqual([{ layerId: 'A', ids: ['a1', 'a2'] }]);
    expect(isPicked(objectPicks('d'), 'A', 'a2')).toBe(true);
    pickObject('d', 'B', 'b1', false);
    expect(objectPicks('d')).toEqual([{ layerId: 'B', ids: ['b1'] }]);
  });
});

describe('edits on a multi-layer pick', () => {
  it('a look change reaches each shape in its own layer as one undo step', () => {
    const picks = [{ layerId: 'A', ids: ['a1'] }, { layerId: 'B', ids: ['b1'] }];
    expect(patchPickedShapes('s', 'd', fx.doc, picks, { cap: 'square', strokeWidth: 5 })).toBe(2);
    expect(fx.records).toBe(1);
    const [A, B] = fx.doc.layers as VectorLayer[];
    expect(A.shapes.map((s) => [s.cap, s.strokeWidth])).toEqual([['square', 5], [undefined, 2]]);
    expect(B.shapes[0].cap).toBe('square');
  });
  it('a locked layer is left alone', () => {
    fx.doc = mk([layer('A', [shape('a1')]), layer('B', [shape('b1')], { locked: true })]);
    expect(patchPickedShapes('s', 'd', fx.doc, [{ layerId: 'A', ids: ['a1'] }, { layerId: 'B', ids: ['b1'] }], { cap: 'butt' })).toBe(1);
    expect((fx.doc.layers[1] as VectorLayer).shapes[0].cap).toBeUndefined();
  });
  it('delete and align act in every layer at once', () => {
    const picks = [{ layerId: 'A', ids: ['a2'] }, { layerId: 'B', ids: ['b1'] }];
    alignPicks('s', 'd', fx.doc, picks, 'left', 'page');
    expect(fx.records).toBe(1);
    deletePicks('s', 'd', fx.doc, picks);
    expect(fx.records).toBe(2);
    expect((fx.doc.layers[0] as VectorLayer).shapes.map((s) => s.id)).toEqual(['a1']);
    expect((fx.doc.layers[1] as VectorLayer).shapes).toEqual([]);
  });
});

describe('findShapesByLook', () => {
  const doc = () => mk([
    layer('A', [shape('def'), shape('butt', { cap: 'butt' }), shape('bevel', { join: 'bevel' }), shape('bb', { cap: 'butt', join: 'bevel' })]),
    layer('B', [shape('b-round', { cap: 'round', join: 'round' }), shape('b-butt', { cap: 'butt' }), shape('nostroke', { stroke: null }), shape('zero', { strokeWidth: 0 })]),
    layer('H', [shape('h-butt', { cap: 'butt' })], { visible: false }),
    layer('L', [shape('l-butt', { cap: 'butt' })], { locked: true }),
  ]);
  const ids = (r: Array<{ shapeId: string }>) => r.map((x) => x.shapeId);
  it('an absent cap or join counts as round', () => {
    expect(ids(findShapesByLook(doc(), { cap: 'round', join: 'round' }))).toEqual(['def', 'b-round']);
  });
  it('Any matches every stroked shape; no-stroke, hidden and locked layers are skipped', () => {
    expect(ids(findShapesByLook(doc(), { cap: 'any', join: 'any' }))).toEqual(['def', 'butt', 'bevel', 'bb', 'b-round', 'b-butt']);
  });
  it('finds several shapes per layer across layers', () => {
    const r = findShapesByLook(doc(), { cap: 'butt', join: 'any' });
    expect(r).toEqual([{ layerId: 'A', shapeId: 'butt' }, { layerId: 'A', shapeId: 'bb' }, { layerId: 'B', shapeId: 'b-butt' }]);
  });
  it('several references give the union', () => {
    expect(ids(findShapesByLook(doc(), [{ cap: 'butt', join: 'bevel' }, { cap: 'round', join: 'bevel' }]))).toEqual(['bevel', 'bb']);
  });
});
