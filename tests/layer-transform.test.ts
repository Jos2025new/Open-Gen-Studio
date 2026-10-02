import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
import { alignDelta, turnProblem, turnVector } from '../src/engine/design/transform';
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
