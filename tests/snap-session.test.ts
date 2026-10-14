import { describe, expect, it } from 'vitest';
import { SnapSession, MAX_LINES } from '../src/engine/design/snapSession';
import { newVectorLayer } from '../src/engine/design/doc';
import { SNAP_SPEED } from '../src/engine/design/snap';
import type { VectorShape } from '../src/engine/types';

const layerAt = (id: string, x: number, y: number, w = 50, h = 50) => {
  const shape = { id: id + 's', type: 'rect', x, y, w, h, fill: '#fff', stroke: null, strokeWidth: 0, radius: 0 } as VectorShape;
  return { ...newVectorLayer(id), id, shapes: [shape] };
};
const doc = (layers: any[]) => ({ width: 1000, height: 1000, layers, guides: undefined } as any);
const view = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
const opts = { on: true, page: false, layers: true };

describe('snap session: candidates once, by band, on screen, capped', () => {
  it('a layer in another horizontal band is not a line for the moving box', () => {
    const s = new SnapSession(doc([layerAt('near', 300, 0), layerAt('far', 300, 700)]), 'mover', opts, 1, view);
    // The box is in the top band (y 0–40): its x may snap to the near layer's edge at 300 but not to the far layer's.
    const xsNear = s.step({ x: 296, y: 0, w: 10, h: 40 }, { x: 300, y: 20 }, { x: 0, y: 0 }, 0);
    expect(xsNear.gx).toBe(300);
    const t = s.targets().ys;
    expect(t).toContain(700); // the far layer is still known for a vertical snap in its own band
  });

  it('lines far off the view are never collected', () => {
    const s = new SnapSession(doc([layerAt('off', 5000, 5000)]), 'mover', opts, 1, view);
    expect(s.targets().xs).toHaveLength(0);
  });

  it('the total of lines is capped', () => {
    const many = Array.from({ length: 400 }, (_, i) => layerAt('l' + i, (i % 20) * 40, Math.floor(i / 20) * 40, 20, 20));
    const s = new SnapSession(doc(many), 'mover', opts, 1, view);
    expect(s.targets().xs.length + s.targets().ys.length).toBeLessThanOrEqual(2 * MAX_LINES);
  });

  it('a fast pointer gets no nudge; a slow one snaps', () => {
    const s = new SnapSession(doc([layerAt('a', 300, 0)]), 'mover', opts, 1, view);
    const box = { x: 296, y: 0, w: 10, h: 40 };
    s.step(box, { x: 0, y: 0 }, { x: 0, y: 0 }, 0);
    const fast = s.step(box, { x: 0, y: 0 }, { x: 100, y: 0 }, 1); // 100 px in 1 ms
    expect(fast.dx).toBe(0);
    const slow = s.step(box, { x: 0, y: 0 }, { x: 100.01, y: 0 }, 1000); // tiny move, long gap
    // The box centre (301) is the nearest edge to the line at 300: it wins with snap distance 1.
    expect(slow.dx).toBeCloseTo(-1, 9);
    expect(SNAP_SPEED).toBeGreaterThan(0);
  });
});
