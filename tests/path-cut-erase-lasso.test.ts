import { describe, expect, it } from 'vitest';
import { cutPathAcross, cutPathAt, nearestOnPath, splitCubic } from '../src/engine/design/pathCut';
import { erasePath } from '../src/engine/design/vectorErase';
import { nodesInLasso, pointInPolygon } from '../src/engine/design/lassoNodes';
import { parseSegs, type Pt, type Seg } from '../src/engine/design/pathNodes';

const line = parseSegs('M 0 0 L 100 0');
const square = parseSegs('M 0 0 L 100 0 L 100 100 L 0 100 Z');
const end = (s: Seg): Pt => s.p[s.p.length - 1];
const first = (p: Seg[]): Pt => p[0].p[0];
const last = (p: Seg[]): Pt => end(p[p.length - 1]);
const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

describe('splitCubic', () => {
  it('halves join at the cut point and keep the endpoints', () => {
    const [l, r] = splitCubic([0, 0], [0, 50], [100, 50], [100, 0], 0.3);
    expect(l[0]).toEqual([0, 0]);
    expect(r[3]).toEqual([100, 0]);
    expect(near(l[3], r[0])).toBe(true);
    const [m1, m2] = splitCubic([0, 0], [0, 50], [100, 50], [100, 0], 0.5);
    expect(near(m1[3], [50, 37.5])).toBe(true);
    expect(m2[0]).toEqual(m1[3]);
  });
});

describe('cutPathAt', () => {
  it('opens an open path into two', () => {
    const r = cutPathAt(line, 1, 0.25);
    expect(r).toHaveLength(2);
    expect(near(last(r[0]), [25, 0])).toBe(true);
    expect(near(first(r[1]), [25, 0])).toBe(true);
    expect(near(last(r[1]), [100, 0])).toBe(true);
  });
  it('opens a closed path into one open path starting and ending at the cut', () => {
    const r = cutPathAt(square, 2, 0.5);
    expect(r).toHaveLength(1);
    expect(near(first(r[0]), [100, 50])).toBe(true);
    expect(near(last(r[0]), [100, 50])).toBe(true);
    expect(r[0].some((s) => s.c === 'Z')).toBe(false);
  });
  it('cuts a curve with continuity', () => {
    const r = cutPathAt(parseSegs('M 0 0 C 0 50 100 50 100 0'), 1, 0.5);
    expect(near(last(r[0]), first(r[1]))).toBe(true);
    expect(r[0][1].c).toBe('C');
  });
});

describe('cutPathAcross', () => {
  it('0 crossings leaves the path', () => {
    expect(cutPathAcross(line, [0, 10], [100, 10])).toHaveLength(1);
  });
  it('1 crossing splits an open path in two', () => {
    const r = cutPathAcross(line, [50, -10], [50, 10]);
    expect(r).toHaveLength(2);
    expect(near(last(r[0]), [50, 0])).toBe(true);
  });
  it('2 crossings of a closed path give two pieces', () => {
    expect(cutPathAcross(square, [50, -10], [50, 110])).toHaveLength(2);
  });
  it('ignores crossings outside the cutting segment', () => {
    expect(cutPathAcross(line, [50, 5], [50, 10])).toHaveLength(1);
  });
  it('a gap takes half of it out on each side of the cut', () => {
    const r = cutPathAcross(line, [50, -10], [50, 10], 10);
    expect(r).toHaveLength(2);
    expect(Math.abs(last(r[0])[0] - 45)).toBeLessThan(1e-3);
    expect(Math.abs(first(r[1])[0] - 55)).toBeLessThan(1e-3);
  });
  it('a gap runs past a corner into the next edge, and opens a closed path at both cuts', () => {
    const r = cutPathAcross(parseSegs('M 0 0 L 4 0 L 4 100'), [-1, 2], [10, 2], 0);
    expect(r).toHaveLength(2);
    const g = cutPathAcross(parseSegs('M 0 0 L 4 0 L 4 100'), [0, 10], [10, 10], 20);
    expect(near(last(g[0]), [4, 0])).toBe(true); // 10 back from (4,10): 10 along the vertical edge, ends at the corner
    expect(Math.abs(first(g[1])[1] - 20)).toBeLessThan(1e-3);
    const sq = cutPathAcross(square, [50, -10], [50, 110], 10);
    expect(sq).toHaveLength(2);
    for (const p of sq) for (const q of [first(p), last(p)]) expect(Math.abs(Math.abs(q[0] - 50) - 5)).toBeLessThan(1e-3);
  });
  it('a gap on a curve is measured along the curve', () => {
    const arc = parseSegs('M 0 0 C 0 50 100 50 100 0');
    const [a, b] = cutPathAcross(arc, [50, -10], [50, 100], 20);
    const gapStraight = Math.hypot(first(b)[0] - last(a)[0], first(b)[1] - last(a)[1]);
    expect(gapStraight).toBeGreaterThan(19);
    expect(gapStraight).toBeLessThan(20.01);
  });
});

describe('nearestOnPath', () => {
  it('finds segment, t and distance', () => {
    const h = nearestOnPath(square, [60, -7])!;
    expect(h.segmentIndex).toBe(1);
    expect(h.t).toBeCloseTo(0.6, 4);
    expect(h.distance).toBeCloseTo(7, 4);
  });
});

describe('erasePath', () => {
  it('erases the middle into two parts', () => {
    const r = erasePath(line, [50, 0], 10);
    expect(r).toHaveLength(2);
    expect(near(last(r[0]), [40, 0])).toBe(true);
    expect(near(first(r[1]), [60, 0])).toBe(true);
  });
  it('erases the start', () => {
    const r = erasePath(line, [0, 0], 10);
    expect(r).toHaveLength(1);
    expect(near(first(r[0]), [10, 0])).toBe(true);
  });
  it('erases the end', () => {
    const r = erasePath(line, [100, 0], 10);
    expect(r).toHaveLength(1);
    expect(near(last(r[0]), [90, 0])).toBe(true);
  });
  it('erases everything', () => {
    expect(erasePath(line, [50, 0], 80)).toHaveLength(0);
  });
  it('a miss leaves the path', () => {
    expect(erasePath(line, [50, 40], 10)).toHaveLength(1);
  });
  it('catches a narrow crossing between samples', () => {
    expect(erasePath(line, [50, 0.4], 0.5)).toHaveLength(2);
  });
  it('a closed path erased once becomes one open path', () => {
    const r = erasePath(square, [50, 0], 10);
    expect(r).toHaveLength(1);
    expect(near(first(r[0]), [60, 0])).toBe(true);
    expect(near(last(r[0]), [40, 0])).toBe(true);
  });
});

describe('lasso', () => {
  const poly: Pt[] = [[-10, -10], [60, -10], [60, 60], [-10, 60]];
  it('point in polygon', () => {
    expect(pointInPolygon([10, 10], poly)).toBe(true);
    expect(pointInPolygon([80, 10], poly)).toBe(false);
  });
  it('selects the nodes inside only (closing twin counted once)', () => {
    expect(nodesInLasso(square, poly)).toEqual([0]);
    expect(nodesInLasso(square, [[-10, -10], [110, -10], [110, 110], [-10, 110]])).toEqual([0, 1, 2, 3]);
    expect(nodesInLasso(square, [[200, 200], [300, 200], [300, 300]])).toEqual([]);
  });
});

it('a miss returns the path itself, so callers record nothing (closed path with an implicit close)', async () => {
  const { cutPathAcross, cutPathAt } = await import('../src/engine/design/pathCut');
  const { erasePath } = await import('../src/engine/design/vectorErase');
  const tri = [{ c: 'M' as const, p: [[0, 0]] as [number, number][] }, { c: 'L' as const, p: [[10, 0]] as [number, number][] }, { c: 'L' as const, p: [[10, 10]] as [number, number][] }, { c: 'Z' as const, p: [] as [number, number][] }];
  expect(cutPathAcross(tri, [50, 50], [60, 60])[0]).toBe(tri);
  expect(erasePath(tri, [50, 50], 2)[0]).toBe(tri);
  expect(cutPathAt(tri, 99, 0.5)[0]).toBe(tri);
});
