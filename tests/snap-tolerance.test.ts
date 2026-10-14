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
