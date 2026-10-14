import { describe, expect, it } from 'vitest';
import { SNAP_PX, snapBox, snapTolerance } from '../src/engine/design/snap';

describe('snap tolerance: 10 screen px at any zoom', () => {
  it('is 10 px of screen divided by the zoom', () => {
    expect(SNAP_PX).toBe(10);
    expect(snapTolerance(1)).toBe(10);
    expect(snapTolerance(2)).toBe(5);
    expect(snapTolerance(0.5)).toBe(20);
  });
  it('the same screen distance snaps at every zoom', () => {
    for (const z of [0.25, 1, 4]) {
      const tol = snapTolerance(z);
      const inside = snapBox({ x: 0, y: 0, w: 10, h: 10 }, { xs: [10 + tol * 0.9], ys: [] }, tol);
      const outside = snapBox({ x: 0, y: 0, w: 10, h: 10 }, { xs: [10 + tol * 1.1], ys: [] }, tol);
      expect(inside.dx).toBeCloseTo(tol * 0.9, 9);
      expect(outside.dx).toBe(0);
    }
  });
});

import { snapScore } from '../src/engine/design/snap';
describe('snap scoring: one winner by pointer and snap distance (weight 0.5)', () => {
  it('between two targets at the same snap distance, the one nearer the pointer wins', () => {
    // Box left edge at 0; targets at 3 and at -3. Pointer near 3.
    const r = snapBox({ x: 0, y: 0, w: 10, h: 10 }, { xs: [3, -3], ys: [] }, 10, { x: 3, y: 5 });
    expect(r.gx).toBe(3);
  });
  it('with weight 0 only the snap distance counts: the closer edge wins', () => {
    const a = snapScore({ snapDist: 1, pointerDist: 50 }, 0, 10, 0);
    const b = snapScore({ snapDist: 2, pointerDist: 0 }, 0, 10, 0);
    expect(a).toBeLessThan(b);
  });
  it('the score follows the Inkscape formula: w·pointer/(min+1) + (1−w)·snap/min(50,tol)', () => {
    expect(snapScore({ snapDist: 4, pointerDist: 9 }, 1, 10, 0.5)).toBeCloseTo(0.5 * 9 / 2 + 0.5 * 4 / 10, 12);
  });
});
