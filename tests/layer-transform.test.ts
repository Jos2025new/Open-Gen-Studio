import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
import { alignDelta, alignDeltas, distributeDeltas, turnProblem, turnVector } from '../src/engine/design/transform';
import type { VectorLayer } from '../src/engine/types';

const base = { id: 'v', name: 'V', visible: true, locked: false, opacity: 1, blend: 'normal' as const, type: 'vector' as const };
const rectLayer = (): VectorLayer => ({ ...base, shapes: [{ id: 's', type: 'rect', x: 0, y: 0, w: 100, h: 40, fill: '#fff', stroke: null, strokeWidth: 0, radius: 0 }] });

describe('Edit: align and transform a layer', () => {
  it('aligns a layer to the page edges and center', () => {
    const doc = { width: 1000, height: 500 };
    const l = rectLayer();
    expect(alignDelta(doc, l, 'right')).toEqual({ dx: 900, dy: 0 });
    expect(alignDelta(doc, l, 'center')).toEqual({ dx: 450, dy: 0 });
    expect(alignDelta(doc, l, 'bottom')).toEqual({ dx: 0, dy: 460 });
  });

  it('turns a vector layer a quarter about its center (box sides swap) and flips it in place', () => {
    const turned = turnVector(rectLayer(), 'rotate-cw').shapes[0];
    expect(turned).toMatchObject({ x: 30, y: -30, w: 40, h: 100 }); // center (50,20) stays
    const flipped = turnVector({ ...rectLayer(), strokes: [{ id: 'k', points: [[0, 0, 0.5], [100, 40, 0.5]], simulatePressure: false } as never] }, 'flip-h');
    expect(flipped.strokes![0].points.map((p) => Math.round(p[0]))).toEqual([100, 0]);
  });

  it('says why when it cannot', () => {
    expect(turnProblem({ ...rectLayer(), locked: true }, 'flip-h')).toMatch(/locked/);
    expect(turnProblem({ ...rectLayer(), shapes: [{ ...rectLayer().shapes[0], type: 'path', d: 'M0 0L1 1' }] }, 'rotate-cw')).toMatch(/paths/);
    expect(turnProblem({ ...base, type: 'text' } as never, 'flip-h')).toMatch(/Text/);
  });
});

const rect = (id: string, x: number, y: number, w: number, h: number): VectorLayer => ({ ...base, id, name: id, shapes: [{ id: `${id}s`, type: 'rect', x, y, w, h, fill: '#fff', stroke: null, strokeWidth: 0, radius: 0 }] });

describe('Edit with several layers: relative to and distribute', () => {
  const doc = { width: 1000, height: 1000 };
  const a = rect('a', 100, 0, 50, 50), b = rect('b', 300, 0, 200, 200), c = rect('c', 800, 0, 20, 20);
  it('aligns to the selection, the first or last picked, the biggest or the smallest', () => {
    expect(alignDeltas(doc, [a, b, c], 'left', 'selection').get('b')).toEqual({ dx: -200, dy: 0 });
    expect(alignDeltas(doc, [a, b, c], 'left', 'first').has('a')).toBe(false);
    expect(alignDeltas(doc, [a, b, c], 'left', 'last').get('a')).toEqual({ dx: 700, dy: 0 });
    expect(alignDeltas(doc, [a, b, c], 'bottom', 'biggest').get('a')).toEqual({ dx: 0, dy: 150 });
    expect(alignDeltas(doc, [a, b, c], 'right', 'smallest').get('b')).toEqual({ dx: 320, dy: 0 });
    expect(alignDeltas(doc, [a, b, c], 'right', 'page').get('c')).toEqual({ dx: 180, dy: 0 });
  });
  it('spaces 3+ layers evenly, the outer two staying', () => {
    const d = distributeDeltas([a, b, c], 'h');
    expect(d.has('a') || d.has('c')).toBe(false);
    expect(d.get('b')).toEqual({ dx: 75, dy: 0 }); // span 100..820, used 270 → gaps of 225: b starts at 375
  });
});
