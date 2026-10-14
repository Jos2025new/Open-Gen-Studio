import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { addDoc, getDoc, patchLayer, undoDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { primKnotDrag, toBox } from '../src/engine/design/primKnots';
import { primShape } from '../src/engine/design/primitives';
import { gradientKnots, moveGradientKnot } from '../src/engine/design/gradientPaint';
import { useStore } from '../src/store/store';
import type { GradientPaint } from '../src/engine/shapeSpec';
import type { VectorShape } from '../src/engine/types';

/* A handle drag is one undo step: the first move records it (record: true), the rest of the drag joins it. The same
   calls the handles make (ShapeHandles.tsx: patchShape with { record: !moved }). */
describe('shape handles: one drag is one undo step', () => {
  const setup = (shape: VectorShape) => {
    const sid = useStore.getState().activeSessionId;
    const layer = { ...newVectorLayer('v'), shapes: [shape] };
    const doc = { ...createDoc('t', 200, 200), layers: [layer] };
    addDoc(sid, doc);
    const current = () => (getDoc(sid, doc.id)!.layers[0] as { shapes: VectorShape[] }).shapes[0];
    const write = (patch: Partial<VectorShape>, record: boolean) =>
      patchLayer(sid, doc.id, layer.id, { shapes: [{ ...current(), ...patch }] }, { record });
    return { sid, doc, current, write };
  };

  it('a two-step drag of a star\'s inner handle is undone in one step', () => {
    const shape = { ...primShape(0, 0, 100, 100, { kind: 'star', sides: 5, inner: 0.5 }), id: 's1', fill: null, stroke: '#000000', strokeWidth: 1, radius: 0 } as VectorShape;
    const h = setup(shape);
    const first = primKnotDrag(h.current(), 'inner', toBox(h.current(), [0.8, 0]))!;
    h.write(first, true);
    const second = primKnotDrag(h.current(), 'inner', toBox(h.current(), [0.9, 0]))!;
    h.write(second, false);
    expect(h.current().prim?.inner).toBeCloseTo(0.9, 4);
    undoDoc(h.sid, h.doc.id);
    expect(h.current().prim?.inner).toBe(0.5);
  });

  it('dragging an outer radius rescales the box and undoes back to the original box', () => {
    const shape = { ...primShape(0, 0, 100, 100, { kind: 'polygon', sides: 6 }), id: 's2', fill: '#ff0000', stroke: null, strokeWidth: 0, radius: 0 } as VectorShape;
    const h = setup(shape);
    h.write(primKnotDrag(h.current(), 'outer', [50, -10], false)!, true);
    h.write(primKnotDrag(h.current(), 'outer', [50, -20], false)!, false);
    expect(h.current().w).toBeGreaterThan(100);
    undoDoc(h.sid, h.doc.id);
    expect(h.current().w).toBe(100);
    expect(h.current().x).toBe(0);
  });

  it('a gradient handle drag is one undo step too, and the other handle stays', () => {
    const gradient: GradientPaint = { kind: 'linear', x1: 0, y1: 0, x2: 100, y2: 0, stops: [{ offset: 0, color: '#000000', alpha: 1 }, { offset: 1, color: '#ffffff', alpha: 1 }] };
    const shape = { type: 'rect', id: 's3', x: 0, y: 0, w: 100, h: 50, fill: null, stroke: null, strokeWidth: 0, radius: 0, fillGradient: gradient } as VectorShape;
    const h = setup(shape);
    h.write({ fillGradient: moveGradientKnot(h.current().fillGradient!, 'p2', [120, 10]) }, true);
    h.write({ fillGradient: moveGradientKnot(h.current().fillGradient!, 'p2', [140, 10]) }, false);
    expect(h.current().fillGradient!.x2).toBe(140);
    expect(h.current().fillGradient!.x1).toBe(0);
    expect(gradientKnots(h.current().fillGradient!)[1].p).toEqual([140, 10]);
    undoDoc(h.sid, h.doc.id);
    expect(h.current().fillGradient!.x2).toBe(100);
  });
});
