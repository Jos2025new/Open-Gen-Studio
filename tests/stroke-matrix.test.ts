import { describe, expect, it } from 'vitest';
import { transformStroke } from '../src/engine/design/affine';
import { bakeStroke, bendStroke, newStroke, nearStroke, outlinePath, solidStrokeSvg, strokeOutline, strokePath, translateStroke, worldPoints, DEFAULT_STROKE_STYLE } from '../src/engine/design/strokes';
import { getStroke } from 'perfect-freehand';
import type { Stroke } from '../src/engine/types';

const line = (len: number, taper = 6, size = 4) => {
  const pts: Array<[number, number, number]> = Array.from({ length: 61 }, (_, i) => [(i * len) / 60, 50, 0.5]);
  return { ...newStroke(pts, { ...DEFAULT_STROKE_STYLE, size, thinning: 0, streamline: 0, smoothing: 0, taperStart: taper, taperEnd: taper }, false), id: 'st' } as Stroke;
};
const hausdorff = (a: number[][], b: number[][]) => {
  const d = (x: number[][], y: number[][]) => Math.max(...x.map((p) => Math.min(...y.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])))));
  return Math.max(d(a, b), d(b, a));
};
const area = (o: number[][]) => Math.abs(o.reduce((a, p, i) => { const q = o[(i + 1) % o.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

describe('stroke matrix: a transform composes the matrix, never rewrites the gesture', () => {
  it('five scales of 0.7 draw the same outline as one of 0.7^5 (Hausdorff < 0.5 px)', () => {
    const s0 = line(200);
    let s = s0;
    for (let i = 0; i < 5; i++) s = transformStroke(s, [0.7, 0, 0, 0.7, 0, 0]);
    const once = transformStroke(s0, [0.7 ** 5, 0, 0, 0.7 ** 5, 0, 0]);
    expect(hausdorff(strokeOutline(s) as number[][], strokeOutline(once) as number[][])).toBeLessThan(0.5);
    expect(s.points).toEqual(s0.points); // the gesture is untouched
  });

  it('rotating and scaling does not deform the stroke: its area is the scale squared times the original', () => {
    const s0 = line(200);
    const a = Math.PI / 6, c = Math.cos(a) * 0.5, sn = Math.sin(a) * 0.5;
    const s = transformStroke(s0, [c, sn, -sn, c, 10, -4]);
    expect(area(strokeOutline(s) as number[][]) / area(strokeOutline(s0) as number[][])).toBeCloseTo(0.25, 2);
  });

  it('a stroke without a matrix draws exactly as before: its outline is the one perfect-freehand gives', () => {
    const s = line(120);
    expect(strokeOutline(s)).toEqual(getStroke(s.points, { size: s.size, thinning: s.thinning, smoothing: s.smoothing, streamline: s.streamline, simulatePressure: s.simulatePressure, start: { taper: s.taperStart, cap: true }, end: { taper: s.taperEnd, cap: true }, last: true }));
  });

  it('save and load keep the matrix and the same outline', () => {
    const s = transformStroke(line(150), [0.6, 0, 0, 0.6, 3, 4]);
    const back = JSON.parse(JSON.stringify(s)) as Stroke;
    expect(back.matrix).toEqual(s.matrix);
    expect(strokePath(back)).toBe(strokePath(s));
  });

  it('the SVG export is the same outline as the canvas uses', () => {
    const s = transformStroke(line(150), [0.5, 0, 0, 0.5, 0, 0]);
    expect(strokePath(s)).toBe(outlinePath(strokeOutline(s) as number[][]));
    expect(solidStrokeSvg(s, (v) => v)).toContain(`d="${strokePath(s)}"`);
  });

  it('editing a transformed stroke bakes the matrix once, exactly, then edits in page coordinates', () => {
    const s = transformStroke(line(120), [2, 0, 0, 2, 10, 0]);
    const before = worldPoints(s)[30];
    const moved = translateStroke(s, 5, -3);
    expect(moved.matrix).toBeUndefined();
    expect(moved.points[30][0]).toBeCloseTo(before[0] + 5, 9);
    expect(moved.points[30][1]).toBeCloseTo(before[1] - 3, 9);
    const bent = bendStroke(s, 30, 0, 8, 0);
    expect(bent.matrix).toBeUndefined();
    expect(bent.points[30][1]).toBeCloseTo(before[1] + 8, 9);
  });

  it('hit testing follows the matrix: a point on the transformed gesture is near, the original place is not', () => {
    const s = transformStroke(line(100), [1, 0, 0, 1, 0, 100]);
    expect(nearStroke(s, 50, 150, 1)).toBe(true);
    expect(nearStroke(s, 50, 50, 1)).toBe(false);
  });

  it('bakeStroke of a stroke without a matrix returns it unchanged', () => {
    const s = line(60);
    expect(bakeStroke(s)).toBe(s);
  });
});
