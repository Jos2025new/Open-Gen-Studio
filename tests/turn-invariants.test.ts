import { describe, expect, it } from 'vitest';
import { turnVector, type Turn } from '../src/engine/design/transform';
import { newStroke } from '../src/engine/design/strokes';
import { newVectorLayer } from '../src/engine/design/doc';
import { layerBox } from '../src/engine/design/render';
import { arrowPath, pathBox } from '../src/engine/design/shapeTools';
import type { VectorLayer } from '../src/engine/types';

/*
 * What each Transform item must do, for every kind of vector content, on shapes that are not symmetric:
 * mirror left↔right keeps every y and mirrors x about the center; mirror top↔bottom the reverse; 180° does both;
 * a quarter turn swaps width and height. And all of them keep the content's center where it was.
 */
const style = { size: 4, color: '#fff', opacity: 1, thinning: 0, smoothing: 0.5, streamline: 0.5, taper: 0 } as never;
function layers(): Array<[string, VectorLayer]> {
  const d = arrowPath(0, 100, 300, 0, 4);
  const b = pathBox(d)!;
  return [
    ['path', { ...newVectorLayer('p'), shapes: [{ id: 'p', type: 'path', d, box0: b, ...b, fill: null, stroke: '#fff', strokeWidth: 4, radius: 0 }] } as VectorLayer],
    ['lineart', { ...newVectorLayer('l'), shapes: [], strokes: [newStroke([[0, 100, 0.5], [100, 90, 0.5], [300, 0, 0.5]], style, false)] } as VectorLayer],
    ['line', { ...newVectorLayer('n'), shapes: [{ id: 'n', type: 'line', x: 0, y: 100, w: 300, h: -100, fill: null, stroke: '#fff', strokeWidth: 4, radius: 0 }] } as VectorLayer],
  ];
}
/** The first point of the content, whatever its kind. */
function firstPoint(l: VectorLayer): [number, number] {
  if (l.strokes?.length) return [l.strokes[0].points[0][0], l.strokes[0].points[0][1]];
  const s = l.shapes[0];
  if (s.type === 'path') { const m = /M ([-\d.]+) ([-\d.]+)/.exec(s.d!)!; return [+m[1], +m[2]]; }
  return [s.x, s.y];
}
const center = (l: VectorLayer) => { const b = layerBox(l)!; return [b.x + b.w / 2, b.y + b.h / 2]; };

describe('Transform: every item does what its name says, for every kind of shape', () => {
  for (const [kind, base] of layers()) {
    const [x0, y0] = firstPoint(base);
    const [cx, cy] = center(base);
    const b0 = layerBox(base)!;
    const after = (t: Turn) => turnVector(base, t);
    it(`${kind}: mirror left↔right moves x only`, () => {
      const [x, y] = firstPoint(after('flip-h'));
      expect(x).toBeCloseTo(2 * cx - x0, 0);
      expect(y).toBeCloseTo(y0, 0);
    });
    it(`${kind}: mirror top↕bottom moves y only`, () => {
      const [x, y] = firstPoint(after('flip-v'));
      expect(x).toBeCloseTo(x0, 0);
      expect(y).toBeCloseTo(2 * cy - y0, 0);
    });
    it(`${kind}: 180° moves both`, () => {
      const [x, y] = firstPoint(after('rotate-180'));
      expect(x).toBeCloseTo(2 * cx - x0, 0);
      expect(y).toBeCloseTo(2 * cy - y0, 0);
    });
    it(`${kind}: quarter turns swap width and height around the same center`, () => {
      for (const t of ['rotate-cw', 'rotate-ccw'] as const) {
        const b = layerBox(after(t))!;
        expect(b.w).toBeCloseTo(b0.h, 0);
        expect(b.h).toBeCloseTo(b0.w, 0);
        expect(b.x + b.w / 2).toBeCloseTo(cx, 0);
        expect(b.y + b.h / 2).toBeCloseTo(cy, 0);
      }
    });
  }
});
