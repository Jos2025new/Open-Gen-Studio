import { describe, expect, it } from 'vitest';
import { turnVector } from '../src/engine/design/transform';
import { newVectorLayer } from '../src/engine/design/doc';
import { arrowPath, pathBox } from '../src/engine/design/shapeTools';
import type { VectorLayer } from '../src/engine/types';

// An arrow pointing right, from (0,0) to (100,0): a shape that is not symmetric, so every turn shows.
function arrowLayer(): VectorLayer {
  const d = arrowPath(0, 0, 100, 0, 4);
  const b = pathBox(d)!;
  return { ...newVectorLayer('a'), shapes: [{ id: 's', type: 'path', d, box0: b, ...b, fill: null, stroke: '#fff', strokeWidth: 4, radius: 0 }] } as VectorLayer;
}
const tip = (l: VectorLayer) => { const m = /M ([-\d.]+) ([-\d.]+) L ([-\d.]+) ([-\d.]+)/.exec(l.shapes[0].d!)!; return { from: [+m[1], +m[2]], to: [+m[3], +m[4]] }; };

describe('flipping and turning drawn paths', () => {
  it('flip horizontal mirrors left↔right, flip vertical up↔down, 180° both, 90° turns; sizes stay positive', () => {
    const base = arrowLayer();
    const h = tip(turnVector(base, 'flip-h'));
    expect(h.from[0]).toBeCloseTo(100); expect(h.to[0]).toBeCloseTo(0);
    const v = turnVector(base, 'flip-v');
    expect(v.shapes[0].h).toBeGreaterThan(0);
    const r180 = tip(turnVector(base, 'rotate-180'));
    expect(r180.from[0]).toBeCloseTo(100);
    const cw = turnVector(base, 'rotate-cw');
    const t = tip(cw);
    // Pointing down after a quarter turn clockwise: same x for both ends, the end below the start.
    expect(t.from[0]).toBeCloseTo(t.to[0]);
    expect(t.to[1]).toBeGreaterThan(t.from[1]);
    expect(cw.shapes[0].w).toBeGreaterThan(0);
    expect(cw.shapes[0].h).toBeGreaterThan(cw.shapes[0].w);
  });
});
