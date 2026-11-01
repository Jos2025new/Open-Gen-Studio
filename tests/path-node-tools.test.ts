// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { cutShape, EraseSession } from '../src/components/designer/PathNodeTools';
import { addDoc, getDoc, patchLayer, undoDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { objectPick, setObjectPick, setShapeEdit, useShapeEdit } from '../src/engine/design/objectSelection';
import { nodesInLasso } from '../src/engine/design/lassoNodes';
import { NODE_EDIT_MODES, NODE_EDIT_MODES_READY, setEraseRadius, setNodeEditMode, useNodeEditMode } from '../src/engine/design/nodeEditMode';
import { parseSegs } from '../src/engine/design/pathNodes';
import { useStore } from '../src/store/store';
import type { VectorShape } from '../src/engine/types';

const path = { type: 'path', d: 'M 0 0 L 100 0', box0: { x: 0, y: 0, w: 100, h: 0 }, x: 0, y: 0, w: 100, h: 0, fill: null, stroke: '#ff0000', strokeWidth: 4, radius: 0 } as never;

function setup() {
  const sid = useStore.getState().activeSessionId, layer = newVectorLayer('s', [path]);
  const doc = { ...createDoc('t', 200, 200), layers: [layer], activeLayerId: layer.id }, id = doc.id;
  addDoc(sid, doc);
  const shape = (getDoc(sid, id)!.layers[0] as { shapes: VectorShape[] }).shapes[0];
  setObjectPick(id, { layerId: layer.id, ids: [shape.id] });
  setShapeEdit(id, { layerId: layer.id, shapeId: shape.id });
  const shapes = () => (getDoc(sid, id)!.layers[0] as { shapes: VectorShape[] }).shapes;
  return { sid, id, layer: layer.id, shape, shapes };
}

describe('node tools', () => {
  it('all five modes are selectable and the erase radius defaults to 10 px', () => {
    expect(NODE_EDIT_MODES_READY).toEqual(NODE_EDIT_MODES);
    expect(useNodeEditMode.getState().eraseRadius).toBe(10);
    setEraseRadius(25); expect(useNodeEditMode.getState().eraseRadius).toBe(25); setEraseRadius(10);
    setNodeEditMode('erase'); expect(useNodeEditMode.getState().mode).toBe('erase');
  });

  it('a click cut keeps one shape with two subpaths while editing, separates them on exit; one undo step each', () => {
    const { sid, id, layer, shape, shapes } = setup();
    const r = { segmentIndex: 1, t: 0.5, point: [50, 0] as [number, number], distance: 0 };
    expect(cutShape(sid, id, layer, shape, { at: r })).toBe(true);
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0].id).toBe(shape.id);
    expect(shapes()[0].d?.match(/M/g)).toHaveLength(2);
    expect(useShapeEdit.getState().byDoc[id]?.shapeId).toBe(shape.id);
    expect(useNodeEditMode.getState().split).not.toBeNull();
    setShapeEdit(id, null);
    const now = shapes();
    expect(now).toHaveLength(2);
    for (const s of now) expect(s).toMatchObject({ stroke: '#ff0000', strokeWidth: 4 });
    expect(objectPick(id)?.ids).toEqual(now.map((s) => s.id));
    undoDoc(sid, id);
    expect(shapes()).toHaveLength(1);
  });

  it('an untouched compound path is not split on exit', () => {
    const { sid, id, layer, shape, shapes } = setup();
    patchLayer(sid, id, layer, { shapes: [{ ...shape, d: 'M 0 0 L 10 0 M 0 20 L 10 20', box0: { x: 0, y: 0, w: 10, h: 20 }, w: 10, h: 20 }] });
    setShapeEdit(id, { layerId: layer, shapeId: shape.id });
    setShapeEdit(id, null);
    expect(shapes()).toHaveLength(1);
  });

  it('a line across cuts; a line that misses changes nothing', () => {
    const { sid, id, layer, shape, shapes } = setup();
    expect(cutShape(sid, id, layer, shape, { across: [[30, -10], [30, 10]] })).toBe(true);
    expect(shapes()[0].d?.match(/M/g)).toHaveLength(2);
    const t = setup();
    expect(cutShape(t.sid, t.id, t.layer, t.shape, { across: [[300, -10], [300, 10]] })).toBe(false);
    expect(t.shapes()).toHaveLength(1);
    expect(t.shapes()[0].d).toBe('M 0 0 L 100 0');
  });

  it('erasing over many samples commits one history entry and keeps the pieces as subpaths', () => {
    const { sid, id, layer, shape, shapes } = setup();
    const e = new EraseSession(sid, id, layer, shape, shapes());
    for (const x of [20, 40, 60]) e.sample([x, 0], 5);
    expect(e.changed).toBe(true);
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0].d?.match(/M/g)!.length).toBeGreaterThanOrEqual(2);
    undoDoc(sid, id);
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0].d).toBe('M 0 0 L 100 0');
  });

  it('lasso selects the nodes inside the loop', () => {
    const segs = parseSegs('M 0 0 L 50 0 L 100 0');
    expect(nodesInLasso(segs, [[-5, -5], [60, -5], [60, 5], [-5, 5]])).toEqual([0, 1]);
  });
});
