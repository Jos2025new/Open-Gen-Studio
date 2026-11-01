// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { cutShape } from '../src/components/designer/PathNodeTools';
import { bandScreenPoints, eraseFilled, isFilledArea } from '../src/components/designer/areaTools';
import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { objectPick, setObjectPick, setShapeEdit, useShapeEdit } from '../src/engine/design/objectSelection';
import { useNodeEditMode } from '../src/engine/design/nodeEditMode';
import { pageSegs } from '../src/engine/design/pathNodes';
import { gradientSvg, elementMatrix } from '../src/engine/design/gradientPaint';
import { apply } from '../src/engine/design/matrix';
import { shapeEditHint } from '../src/components/designer/ShapeKnots';
import { useStore } from '../src/store/store';
import type { VectorShape } from '../src/engine/types';

// A filled circle of radius 50 centred at (100,100), as four cubics.
const K = 27.6142;
const d = `M 150 100 C 150 ${100 + K} ${100 + K} 150 100 150 C ${100 - K} 150 50 ${100 + K} 50 100 C 50 ${100 - K} ${100 - K} 50 100 50 C ${100 + K} 50 150 ${100 - K} 150 100 Z`;
const circle = (over = {}) => ({ type: 'path', d, box0: { x: 50, y: 50, w: 100, h: 100 }, x: 50, y: 50, w: 100, h: 100, fill: '#00aa00', stroke: '#000000', strokeWidth: 2, radius: 0, ...over }) as never;

function setup(shape = circle()) {
  const sid = useStore.getState().activeSessionId, layer = newVectorLayer('s', [shape]);
  const doc = { ...createDoc('t', 300, 300), layers: [layer], activeLayerId: layer.id }, id = doc.id;
  addDoc(sid, doc);
  const get = () => (getDoc(sid, id)!.layers[0] as { shapes: VectorShape[] }).shapes;
  const sh = get()[0];
  setObjectPick(id, { layerId: layer.id, ids: [sh.id] });
  setShapeEdit(id, { layerId: layer.id, shapeId: sh.id });
  return { sid, id, layer: layer.id, shape: sh, shapes: get };
}
const closed = (d?: string) => (d?.match(/Z/g) ?? []).length;

describe('area knife and area eraser on filled closed paths', () => {
  it('knife across a circle gives 2 closed pieces; cutting a piece again gives 3, all filled', () => {
    const t = setup();
    expect(isFilledArea(t.shape)).toBe(true);
    expect(cutShape(t.sid, t.id, t.layer, t.shape, { across: [[100, 0], [100, 200]] })).toBe(true);
    expect(t.shapes()).toHaveLength(1);
    expect(closed(t.shapes()[0].d)).toBe(2);
    expect(cutShape(t.sid, t.id, t.layer, t.shapes()[0], { across: [[60, 0], [60, 200]] })).toBe(true);
    expect(closed(t.shapes()[0].d)).toBe(3);
    setShapeEdit(t.id, null);
    const now = t.shapes();
    expect(now).toHaveLength(3);
    for (const s of now) { expect(s.fill).toBe('#00aa00'); expect(closed(s.d)).toBe(1); }
    expect(objectPick(t.id)?.ids).toEqual(now.map((s) => s.id));
    undoDoc(t.sid, t.id);
    expect(t.shapes()).toHaveLength(1);
  });

  it('a knife that misses changes nothing and records no undo step', () => {
    const t = setup(), before = t.shapes()[0].d;
    expect(cutShape(t.sid, t.id, t.layer, t.shape, { across: [[300, 0], [300, 200]] })).toBe(false);
    expect(t.shapes()[0].d).toBe(before);
    expect(useNodeEditMode.getState().split).toBeNull();
  });

  it('a click on the outline still opens it (scissors)', () => {
    const t = setup();
    expect(cutShape(t.sid, t.id, t.layer, t.shape, { at: { segmentIndex: 1, t: 0.5, point: [135, 135], distance: 0 } })).toBe(true);
    expect(closed(t.shapes()[0].d)).toBe(0);
  });

  it('erasing inside only makes a hole (one shape, one undo step)', () => {
    const t = setup();
    expect(eraseFilled(t.sid, t.id, t.layer, t.shape, [[90, 100], [110, 100]], 8)).toBe(true);
    expect(closed(t.shapes()[0].d)).toBe(2);
    setShapeEdit(t.id, null);
    expect(t.shapes()).toHaveLength(1);
    undoDoc(t.sid, t.id);
    expect(t.shapes()[0].d).toBe(d);
  });

  it('erasing across gives 2 pieces that separate on exit; a piece with a hole stays one object', () => {
    const t = setup();
    expect(eraseFilled(t.sid, t.id, t.layer, t.shape, [[100, 0], [100, 200]], 5)).toBe(true);
    expect(t.shapes()).toHaveLength(1);
    expect(closed(t.shapes()[0].d)).toBe(2);
    // also rub a hole inside the left piece
    expect(eraseFilled(t.sid, t.id, t.layer, t.shapes()[0], [[70, 100], [72, 100]], 4)).toBe(true);
    setShapeEdit(t.id, null);
    const now = t.shapes();
    expect(now).toHaveLength(2);
    expect(now.map((s) => closed(s.d)).sort()).toEqual([1, 2]);
    expect(objectPick(t.id)?.ids).toEqual(now.map((s) => s.id));
    undoDoc(t.sid, t.id);
    expect(t.shapes()).toHaveLength(1);
  });

  it('erasing everything removes the shape and leaves node editing', () => {
    const t = setup();
    expect(eraseFilled(t.sid, t.id, t.layer, t.shape, [[100, 100]], 80)).toBe(true);
    expect(t.shapes()).toHaveLength(0);
    expect(useShapeEdit.getState().byDoc[t.id]).toBeFalsy();
    undoDoc(t.sid, t.id);
    expect(t.shapes()).toHaveLength(1);
  });

  it('an erase that touches nothing records nothing', () => {
    const t = setup();
    expect(eraseFilled(t.sid, t.id, t.layer, t.shape, [[290, 290]], 5)).toBe(false);
    expect(t.shapes()[0].d).toBe(d);
  });

  it('an open or unfilled path is not an area (edge tools keep working)', () => {
    expect(isFilledArea(setup(circle({ fill: null })).shape)).toBe(false);
    expect(isFilledArea(setup(circle({ d: 'M 0 0 L 100 0 L 100 100', fill: '#00aa00' })).shape)).toBe(false);
    const t = setup(circle({ fill: null }));
    expect(cutShape(t.sid, t.id, t.layer, t.shape, { across: [[90, 0], [90, 200]] })).toBe(true);
    expect(pageSegs(t.shapes()[0]).filter((s) => s.c === 'M')).toHaveLength(2);
    expect(closed(t.shapes()[0].d)).toBe(0);
  });

  it('a miss after a first cut (pieces are subpaths of one shape) records nothing', () => {
    const t = setup();
    expect(cutShape(t.sid, t.id, t.layer, t.shape, { across: [[100, 0], [100, 200]] })).toBe(true);
    const cur = t.shapes()[0], d1 = cur.d;
    expect(cutShape(t.sid, t.id, t.layer, cur, { across: [[250, 0], [250, 200]] })).toBe(false);
    expect(eraseFilled(t.sid, t.id, t.layer, cur, [[250, 100], [260, 100]], 5)).toBe(false);
    expect(t.shapes()[0].d).toBe(d1);
    undoDoc(t.sid, t.id);
    expect(t.shapes()[0].d).toBe(d);
  });

  it('gradients are page-anchored: every piece paints the same colours at the same page positions', () => {
    const g = { kind: 'linear', x1: 50, y1: 100, x2: 150, y2: 100, stops: [{ offset: 0, color: '#ff0000', alpha: 1 }, { offset: 1, color: '#0000ff', alpha: 1 }] };
    const t = setup(circle({ fill: null, fillGradient: g }));
    expect(isFilledArea(t.shape)).toBe(true);
    expect(cutShape(t.sid, t.id, t.layer, t.shape, { across: [[100, 0], [100, 200]] })).toBe(true);
    setShapeEdit(t.id, null);
    expect(t.shapes()).toHaveLength(2);
    for (const s of t.shapes()) {
      expect(s.fillGradient).toEqual(g);
      const m = /x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/.exec(gradientSvg(g as never, s, 'x', (v) => v))!;
      const [x1, y1] = apply(elementMatrix(s), +m[1], +m[2]), [x2, y2] = apply(elementMatrix(s), +m[3], +m[4]);
      expect([x1, y1, x2, y2].map(Math.round)).toEqual([50, 100, 150, 100]);
    }
  });

  it('hints use isFilledArea: fill none without gradient is edge-only', () => {
    const t = setup(circle({ fill: 'none' }));
    useNodeEditMode.setState({ mode: 'cut' });
    expect(shapeEditHint(getDoc(t.sid, t.id)!).text).toMatch(/click the path to cut it/);
    useNodeEditMode.setState({ mode: 'erase' });
    expect(shapeEditHint(getDoc(t.sid, t.id)!).text).toMatch(/over the path/);
    useNodeEditMode.setState({ mode: 'move' });
  });

  it('the live erase preview is a plain polyline of the trail (no boolean per event)', () => {
    const id = (p: [number, number]) => ({ x: p[0] * 2, y: p[1] * 2 });
    expect(bandScreenPoints([[1, 1], [2, 3]], id)).toBe('2.0,2.0 4.0,6.0');
    expect(bandScreenPoints([[1, 1]], id)).toBe('2.0,2.0 2.0,2.0');
  });
});
