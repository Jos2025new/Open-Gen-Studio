import { describe, expect, it } from 'vitest';
import { transformStroke, transformObjects } from '../src/engine/design/affine';
import { newStroke, strokeOutline, DEFAULT_STROKE_STYLE } from '../src/engine/design/strokes';
import { newVectorLayer } from '../src/engine/design/doc';
import type { Stroke } from '../src/engine/types';

const area = (o: number[][]) => Math.abs(o.reduce((a, p, i) => { const q = o[(i + 1) % o.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const line = (len: number, taper: number) => {
  const pts: Array<[number, number, number]> = Array.from({ length: 61 }, (_, i) => [(i * len) / 60, 50, 0.5]);
  return { ...newStroke(pts, { ...DEFAULT_STROKE_STYLE, size: 4, thinning: 0, streamline: 0, smoothing: 0, taperStart: taper, taperEnd: taper }, false), id: 'st' } as Stroke;
};

describe('lineart stroke under transform: width and tapers follow the scale', () => {
  it('five scales of 0.7 give the same width and tapers as one scale of 0.7^5', () => {
    const s0 = line(200, 6);
    const k = 0.7;
    let s = s0;
    for (let i = 0; i < 5; i++) s = transformStroke(s, [k, 0, 0, k, 0, 0]);
    const once = transformStroke(s0, [k ** 5, 0, 0, k ** 5, 0, 0]);
    expect(s.size).toBeCloseTo(once.size, 12);
    expect(s.taperStart).toBeCloseTo(once.taperStart, 12);
    expect(s.size).toBeCloseTo(4 * k ** 5, 12);
    expect(s.taperStart).toBeCloseTo(6 * k ** 5, 12);
  });

  it('the outline area is proportional to the scale squared (the stroke does not turn into a blob)', () => {
    const s0 = line(200, 6);
    const k = 0.5;
    const a0 = area(strokeOutline(s0) as number[][]);
    const a1 = area(strokeOutline(transformStroke(s0, [k, 0, 0, k, 0, 0])) as number[][]);
    // Tolerance: perfect-freehand's absolute thresholds make the outline only approximately scale-true (outline notes).
    expect(Math.abs(a1 / a0 - k * k) / (k * k)).toBeLessThan(0.15);
  });

  it('the width has a floor of 0.5 px, as scaleStroke has', () => {
    expect(transformStroke(line(50, 0), [0.01, 0, 0, 0.01, 0, 0]).size).toBe(0.5);
  });

  it('a layer transform keeps the same rule for every picked stroke', () => {
    const layer = { ...newVectorLayer('l'), strokes: [line(100, 3)] } as any;
    const out = transformObjects(layer, null, [0.5, 0, 0, 0.5, 0, 0]);
    expect((out as { strokes: Stroke[] }).strokes[0].taperStart).toBeCloseTo(1.5, 12);
  });
});
