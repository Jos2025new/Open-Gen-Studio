import type { Seg } from './pathNodes';

/*
 * Dragging a segment: the curve bends so that the point grabbed on it (parameter t) follows the pointer. The move is
 * shared by the two handles of that segment with Inkscape's weights (curve-drag-point.cpp, CurveDragPoint::dragged):
 * weight w(t) is 0 near the start, 1 near the end and rises between (lines 99–104); the front handle moves by
 * (1−w)/(3t(1−t)²) of the pointer's move and the back one by w/(3t²(1−t)) (lines 109–110). Those two shares add up
 * to exactly the move, so the curve passes through the pointer. A straight segment first gets handles at its thirds.
 */

type P = [number, number];

/** Inkscape's weight: 0 = only the front handle moves, 1 = only the back handle. */
export function dragWeight(t: number): number {
  if (t <= 1 / 6) return 0;
  if (t <= 0.5) return Math.pow((6 * t - 1) / 2, 3) / 2;
  if (t <= 5 / 6) return (1 - Math.pow((6 * (1 - t) - 1) / 2, 3)) / 2 + 0.5;
  return 1;
}

export function bezierAt(p0: P, c1: P, c2: P, p3: P, t: number): P {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
}

/** The point of segment i (ending at a node) nearest to p: its parameter t and distance, sampled. */
export function nearestOnSegment(segs: Seg[], i: number, p: P): { t: number; dist: number } | null {
  const s = segs[i], prev = segs[i - 1];
  if (!prev || (s.c !== 'L' && s.c !== 'C')) return null;
  const p0 = prev.p[prev.p.length - 1], p3 = s.p[s.p.length - 1];
  const at = (t: number): P => (s.c === 'L' ? [p0[0] + (p3[0] - p0[0]) * t, p0[1] + (p3[1] - p0[1]) * t] : bezierAt(p0, s.p[0], s.p[1], p3, t));
  let best = { t: 0, dist: Infinity };
  for (let k = 1; k < 200; k++) {
    const t = k / 200, q = at(t), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < best.dist) best = { t, dist: d };
  }
  return best;
}

/** The nearest segment to p over the whole path: its index, t and distance. */
export function nearestSegment(segs: Seg[], p: P): { i: number; t: number; dist: number } | null {
  let best: { i: number; t: number; dist: number } | null = null;
  for (let i = 1; i < segs.length; i++) {
    const r = nearestOnSegment(segs, i, p);
    if (r && (!best || r.dist < best.dist)) best = { i, ...r };
  }
  return best;
}

/** Bend segment i so that its point at t lands on `target`; the segment's end nodes stay where they are. */
export function dragSegment(segs: Seg[], i: number, t0: number, target: P): Seg[] {
  const out = segs.map((g) => ({ c: g.c, p: g.p.map((q) => [...q] as P) }));
  const s = out[i], prev = out[i - 1];
  if (!prev || (s.c !== 'L' && s.c !== 'C') || !(t0 > 0 && t0 < 1)) return out;
  const p0 = prev.p[prev.p.length - 1], p3 = s.p[s.p.length - 1];
  if (s.c === 'L') s.p = [[p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3], [p0[0] + (2 * (p3[0] - p0[0])) / 3, p0[1] + (2 * (p3[1] - p0[1])) / 3], p3], s.c = 'C';
  const t = Math.min(0.99, Math.max(0.01, t0)), w = dragWeight(t);
  const b = bezierAt(p0, s.p[0], s.p[1], p3, t);
  const dx = target[0] - b[0], dy = target[1] - b[1];
  const off0 = (1 - w) / (3 * t * (1 - t) * (1 - t)), off1 = w / (3 * t * t * (1 - t));
  s.p[0] = [s.p[0][0] + off0 * dx, s.p[0][1] + off0 * dy];
  s.p[1] = [s.p[1][0] + off1 * dx, s.p[1][1] + off1 * dy];
  return out;
}

