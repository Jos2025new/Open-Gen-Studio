import { describe, expect, it } from 'vitest';
import { nearestGaps, neighbourGaps } from '../src/engine/design/neighbourGaps';
import { newVectorLayer } from '../src/engine/design/doc';
import type { VectorShape } from '../src/engine/types';

const B = (x: number, y: number, w = 10, h = 10) => ({ x, y, w, h });
const layerAt = (id: string, x: number, y: number, w = 10, h = 10, visible = true) => {
  const shape = { id: id + 's', type: 'rect', x, y, w, h, fill: '#fff', stroke: null, strokeWidth: 0, radius: 0 } as VectorShape;
  return { ...newVectorLayer(id), id, shapes: [shape], visible };
};

describe('neighbour gaps while moving', () => {
  it('the nearest box on each side that overlaps on the other axis gives one gap, in document units', () => {
    // Moving box 0–10 × 0–10; a neighbour to the right at x 30 with a y-span 5–15 overlaps it in y.
    const [m] = nearestGaps(B(0, 0), [B(30, 5)]);
    expect(m.label).toBe(20);
    expect(m.a).toEqual([10, 7.5]); // starts at the moving box's right edge, centred on the overlap 5–10
    expect(m.b).toEqual([30, 7.5]);
  });

  it('ignores a neighbour that does not overlap on the other axis', () => {
    expect(nearestGaps(B(0, 0), [B(30, 50)])).toEqual([]);
  });

  it('takes only the nearest neighbour on each side', () => {
    const r = nearestGaps(B(100, 0), [B(150, 0), B(200, 0), B(0, 0)]);
    expect(r.map((m) => m.label)).toEqual([90, 40]); // left gap 90 (to x 10) first, then right gap 40 (to x 150)
  });

  it('measures vertical gaps above and below with the same rules', () => {
    const r = nearestGaps(B(0, 100), [B(4, 50), B(4, 200)]); // above ends at 60, below starts at 200 (sides: above, then below)
    expect(r.map((m) => m.label)).toEqual([40, 90]); // above: 100 − 60; below: 200 − 110
    expect(r[0].a).toEqual([7, 60]); // centred on the overlap 4–10, from the neighbour's bottom edge
    expect(r[0].b).toEqual([7, 100]); // to the moving box's top edge
  });

  it('rounds the label to whole document units', () => {
    expect(nearestGaps(B(0, 0), [B(22.4, 0)])[0].label).toBe(12);
    expect(nearestGaps(B(0, 0), [B(22.6, 0)])[0].label).toBe(13);
  });

  it('boxes that overlap or touch the moving box produce no gap', () => {
    expect(nearestGaps(B(0, 0), [B(5, 0)])).toEqual([]);
    expect(nearestGaps(B(0, 0), [B(10, 0)])).toEqual([]);
  });
});

describe('neighbour gaps from the layers of a document', () => {
  it('measures from where the snap moves the box', () => {
    const layers = [layerAt('near', 30, 0)];
    expect(neighbourGaps(B(0, 0), layers as never, new Set(), { dx: 5 })[0].label).toBe(15); // the box now ends at 15
  });

  it('skips the moving layers and hidden layers, and measures the visible ones', () => {
    const layers = [layerAt('moving', 0, 0), layerAt('near', 30, 0), layerAt('hidden', 15, 0, 10, 10, false), layerAt('far', 60, 0)];
    const gaps = neighbourGaps(B(0, 0), layers as never, new Set(['moving']));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].label).toBe(20); // the hidden box at 15 does not count; the nearest visible one is at 30
  });
});
