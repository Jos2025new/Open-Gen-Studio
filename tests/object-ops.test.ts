import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { alignObjectDeltas, objectAt, objectsBox, translateObjects, turnObjects } from '../src/engine/design/objectOps';
import { newRasterLayer, newVectorLayer } from '../src/engine/design/doc';
import type { RasterLayer, RasterStroke, VectorLayer } from '../src/engine/types';

const doc = { width: 1000, height: 1000 };
const stroke = (id: string, x0: number, y0: number, x1: number, y1: number): RasterStroke => ({ id, x: 0, y: 0, segments: [[x0, y0, x1, y1, 10]], color: '#fff', opacity: 1, erase: false });
// A painted layer at page scale (buffer pixels = page pixels) with two strokes far apart.
function paint(): RasterLayer {
  return { ...newRasterLayer('Paint', { x: 0, y: 0, width: 1000, height: 1000 }, { width: 1000, height: 1000 }), paintBaseId: 'b', paintStrokes: [stroke('a', 100, 100, 300, 150), stroke('b', 600, 600, 700, 900)] };
}
const rect = (id: string, x: number, y: number) => ({ id, type: 'rect' as const, x, y, w: 100, h: 50, fill: '#fff', stroke: null, strokeWidth: 0, radius: 0 });

describe('Edit in Objects mode: only the picked objects change', () => {
  it('painted strokes: mirroring one leaves the other stroke and the layer frame alone, and it stays a stroke', () => {
    const l = paint();
    const out = turnObjects(l, ['a'], 'flip-h') as RasterLayer;
    expect(out.paintStrokes![1]).toEqual(l.paintStrokes![1]);
    expect([out.x, out.y, out.width, out.height]).toEqual([l.x, l.y, l.width, l.height]);
    const [x0, y0, x1, y1] = out.paintStrokes![0].segments[0];
    // Mirrored left↔right about its own center (≈200): x swaps ends, y untouched.
    [[x0, 300], [y0, 100], [x1, 100], [y1, 150]].forEach(([got, want]) => expect(got).toBeCloseTo(want, 1));
    const a = objectsBox(out, ['a'])!, b = objectsBox(l, ['a'])!;
    expect(a.x + a.w / 2).toBeCloseTo(b.x + b.w / 2, 1); // in place
  });
  it('painted strokes: a quarter turn keeps the center; picking finds the stroke under the pointer', () => {
    const l = paint();
    const b0 = objectsBox(l, ['b'])!;
    const b1 = objectsBox(turnObjects(l, ['b'], 'rotate-cw'), ['b'])!;
    expect(b1.x + b1.w / 2).toBeCloseTo(b0.x + b0.w / 2);
    expect(b1.y + b1.h / 2).toBeCloseTo(b0.y + b0.h / 2);
    expect(objectAt(l, 650, 750)).toBe('b');
    expect(objectAt(l, 900, 100)).toBeNull();
  });
  it('vector: turning or moving one shape leaves the others', () => {
    const l = { ...newVectorLayer('v'), shapes: [rect('r1', 0, 0), rect('r2', 500, 500)] } as VectorLayer;
    const t = turnObjects(l, ['r2'], 'rotate-cw') as VectorLayer;
    expect(t.shapes[0]).toEqual(l.shapes[0]);
    expect([t.shapes[1].w, t.shapes[1].h]).toEqual([50, 100]);
    const m = translateObjects(l, ['r1'], 10, 20) as VectorLayer;
    expect([m.shapes[0].x, m.shapes[0].y, m.shapes[1].x]).toEqual([10, 20, 500]);
  });
  it('align: one object to the page; several to their joint box', () => {
    const l = { ...newVectorLayer('v'), shapes: [rect('r1', 0, 0), rect('r2', 500, 500)] } as VectorLayer;
    expect(alignObjectDeltas(doc, l, ['r2'], 'right', 'selection').get('r2')).toEqual({ dx: 400, dy: 0 });
    const both = alignObjectDeltas(doc, l, ['r1', 'r2'], 'left', 'selection');
    expect(both.get('r2')).toEqual({ dx: -500, dy: 0 });
    expect(both.has('r1')).toBe(false);
  });
});

import { deletePickedObjects } from '../src/engine/design/objectOps';
import { useStore } from '../src/store/store';

describe('Delete removes only the picked objects of the active layer', () => {
  it('a vector layer keeps its other shapes and the layer itself', () => {
    const v: VectorLayer = { ...newVectorLayer('Shapes'), shapes: [rect('r1', 0, 0), rect('r2', 300, 300)] };
    const sid = useStore.getState().activeSessionId;
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], docs: [{ id: 'dd', name: 'D', width: 1000, height: 1000, layers: [v], activeLayerId: v.id, createdAt: 0, updatedAt: 0 } as never] } } }));
    deletePickedObjects(sid, 'dd', v.id, ['r1']);
    const after = useStore.getState().sessions[sid].docs[0].layers;
    expect(after).toHaveLength(1);
    expect((after[0] as VectorLayer).shapes.map((s) => s.id)).toEqual(['r2']);
  });
});
