import { describe, expect, it } from 'vitest';
import { cutStroke, eraseStroke, nearestOnStroke } from '../src/engine/design/strokeCut';
import { newStroke } from '../src/engine/design/strokes';
import { DEFAULT_STROKE_STYLE } from '../src/engine/design/strokes';

const line = () => newStroke([[0, 0, 0.2], [100, 0, 0.8]], { ...DEFAULT_STROKE_STYLE, size: 4 }, false);
const long = () => newStroke([[0, 0, 0.5], [50, 0, 0.5], [100, 0, 0.5], [150, 0, 0.5]], DEFAULT_STROKE_STYLE, false);

describe('cutStroke', () => {
  it('splits at the nearest point and interpolates x, y and pressure; pieces are new strokes with the same style', () => {
    const s = line(), [a, b] = cutStroke(s, 25, 3, 5);
    expect(a.points[0]).toEqual([0, 0, 0.2]);
    expect(a.points[1][2]).toBeCloseTo(0.35);
    expect(a.points[1].slice(0, 2)).toEqual([25, 0]);
    expect(b.points[0]).toEqual(a.points[1]);
    expect(b.points[1]).toEqual([100, 0, 0.8]);
    expect(new Set([a.id, b.id, s.id]).size).toBe(3);
    expect(a.color).toBe(s.color); expect(b.size).toBe(s.size);
  });
  it('a miss returns the same stroke, and so does a cut on an end', () => {
    const s = line();
    expect(cutStroke(s, 50, 40, 5)).toEqual([s]);
    expect(cutStroke(s, 50, 40, 5)[0]).toBe(s);
    expect(cutStroke(s, -1, 0, 5)[0]).toBe(s);
  });
  it('keeps the interior points on each side', () => {
    const [a, b] = cutStroke(long(), 75, 0, 3);
    expect(a.points.map((p) => p[0])).toEqual([0, 50, 75]);
    expect(b.points.map((p) => p[0])).toEqual([75, 100, 150]);
  });
  it('respects the matrix: works in page coordinates', () => {
    const s = { ...line(), matrix: [1, 0, 0, 1, 10, 20] as [number, number, number, number, number, number] };
    expect(nearestOnStroke(s, 60, 20)?.distance).toBe(0);
    const [a, b] = cutStroke(s, 60, 20, 3);
    expect(a.matrix).toBeUndefined();
    expect(a.points[1].slice(0, 2)).toEqual([60, 20]);
    expect(b.points[1]).toEqual([110, 20, 0.8]);
    expect(cutStroke(s, 50, 0, 3)[0]).toBe(s);
  });
});

describe('eraseStroke', () => {
  it('removes the points inside the circle, splitting with interpolated boundaries', () => {
    const s = long(), out = eraseStroke(s, [75, 0], 10);
    expect(out).toHaveLength(2);
    expect(out[0].points).toEqual([[0, 0, 0.5], [50, 0, 0.5], [65, 0, 0.5]]);
    expect(out[1].points).toEqual([[85, 0, 0.5], [100, 0, 0.5], [150, 0, 0.5]]);
    expect(out[0].id).not.toBe(s.id);
  });
  it('interpolates pressure at the boundary', () => {
    const [a, b] = eraseStroke(line(), [50, 0], 10);
    expect(a.points[1][2]).toBeCloseTo(0.2 + 0.6 * 0.4);
    expect(b.points[0][2]).toBeCloseTo(0.2 + 0.6 * 0.6);
  });
  it('a miss returns the same stroke', () => {
    const s = long();
    expect(eraseStroke(s, [75, 50], 10)).toEqual([s]);
    expect(eraseStroke(s, [75, 50], 10)[0]).toBe(s);
  });
  it('drops pieces shorter than 2 points and removes a stroke the circle covers', () => {
    const s = long();
    expect(eraseStroke(s, [0, 0], 60)).toHaveLength(1);
    expect(eraseStroke(s, [75, 0], 200)).toEqual([]);
    expect(eraseStroke(newStroke([[5, 5, 1]], DEFAULT_STROKE_STYLE, false), [5, 5], 3)).toEqual([]);
  });
  it('respects the matrix', () => {
    const s = { ...line(), matrix: [1, 0, 0, 1, 0, 100] as [number, number, number, number, number, number] };
    expect(eraseStroke(s, [50, 0], 10)[0]).toBe(s);
    const out = eraseStroke(s, [50, 100], 10);
    expect(out).toHaveLength(2);
    expect(out[0].points[1]).toEqual([40, 100, expect.any(Number)]);
  });
});

it('pieces keep the taper only at the original ends; the new ends are blunt', async () => {
  const { cutStroke } = await import('../src/engine/design/strokeCut');
  const { newStroke, DEFAULT_STROKE_STYLE } = await import('../src/engine/design/strokes');
  const s = newStroke([[0, 0, 0.5], [50, 0, 0.5], [100, 0, 0.5]], { ...DEFAULT_STROKE_STYLE, taperStart: 10, taperEnd: 20 }, false);
  const [head, tail] = cutStroke(s, 50, 0, 5);
  expect([head.taperStart, head.taperEnd, tail.taperStart, tail.taperEnd]).toEqual([10, 0, 0, 20]);
});
