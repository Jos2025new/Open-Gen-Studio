import type { Stroke } from '../strokeTypes';
import { uid } from '../../lib/id';
import { bakeStroke } from './strokes';

/* Cut and erase of Lineart strokes (the stroke edit row: Cut, Erase). Pure geometry on the polyline in page coordinates. */

type P3 = [number, number, number];
const lerp = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const EPS = 1e-6;

/** A piece of `base` (matrix already applied) with new points and a new id; the style is the original's. */
/** A piece keeps the taper only at the ends it shares with the original; a new end (cut or erased) is blunt. */
export function strokePiece(base: Stroke, points: P3[]): Stroke {
  const first = base.points[0], last = base.points[base.points.length - 1];
  return { ...base, id: uid('stk'), points, taperStart: points[0] === first ? base.taperStart : 0, taperEnd: points[points.length - 1] === last ? base.taperEnd : 0 };
}

/** Nearest place on the polyline (page coordinates): the segment `index` (between points index and index+1), `t` along it, and the distance. */
export function nearestOnStroke(s: Stroke, x: number, y: number): { index: number; t: number; point: P3; distance: number } | null {
  const pts = bakeStroke(s).points;
  let best: { index: number; t: number; point: P3; distance: number } | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
    const point = lerp(a, b, t), distance = Math.hypot(x - point[0], y - point[1]);
    if (!best || distance < best.distance) best = { index: i, t, point, distance };
  }
  return best;
}

/**
 * Split a stroke where it passes within `reach` (page px, beyond half its width) of (x, y): two new strokes with the
 * same style, the cut point interpolated (x, y and pressure). A miss, or a cut at an end that would leave one piece
 * with fewer than 2 points, returns `[s]` (the same object: nothing changes).
 */
export function cutStroke(s: Stroke, x: number, y: number, reach: number): Stroke[] {
  const hit = nearestOnStroke(s, x, y);
  if (!hit || hit.distance > reach) return [s];
  const b = bakeStroke(s), pts = b.points, i = hit.index;
  const head = pts.slice(0, i + 1), tail = pts.slice(i + 1);
  if (hit.t > EPS) head.push(hit.point);
  if (hit.t < 1 - EPS) tail.unshift(hit.point);
  if (head.length < 2 || tail.length < 2) return [s];
  return [strokePiece(b, head), strokePiece(b, tail)];
}

/**
 * Cut a stroke at every place where it crosses the line a→b (page coordinates): the pieces keep the style, the new
 * points are interpolated (x, y, pressure), the new ends are blunt. No crossing, or nothing usable left, returns `[s]`.
 */
export function cutStrokeAcross(s: Stroke, a: [number, number], b: [number, number]): Stroke[] {
  const base = bakeStroke(s), pts = base.points, rx = b[0] - a[0], ry = b[1] - a[1], out: P3[][] = [];
  if (pts.length < 2 || Math.hypot(rx, ry) < EPS) return [s];
  let cur: P3[] = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], den = dx * ry - dy * rx;
    const cuts: number[] = [];
    if (Math.abs(den) > EPS) {
      // p + t·d = a + u·r, t in [0, 1) so a crossing on a shared vertex counts once.
      const t = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den, u = ((a[0] - p[0]) * dy - (a[1] - p[1]) * dx) / den;
      if (t >= 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    for (const t of cuts) {
      const at = t === 0 ? p : lerp(p, q, t);
      if (at !== cur[cur.length - 1]) cur.push(at);
      out.push(cur); cur = [at];
    }
    cur.push(q);
  }
  out.push(cur);
  // A line through a vertex can cut both its segments (float error): the zero-length sliver between is dropped.
  const long = (c: P3[]) => c.some((q) => Math.hypot(q[0] - c[0][0], q[1] - c[0][1]) > EPS);
  const pieces = out.filter((c) => c.length >= 2 && long(c));
  return out.length < 2 || pieces.length < 2 ? [s] : pieces.map((c) => strokePiece(base, c));
}

/** Parameter interval of segment a→b inside the circle (open), or null. */
function inside(a: P3, b: P3, c: [number, number], r: number): [number, number] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1], fx = a[0] - c[0], fy = a[1] - c[1];
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  if (A < EPS) return C < 0 ? [0, 1] : null;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return null;
  const q = Math.sqrt(disc), t0 = (-B - q) / (2 * A), t1 = (-B + q) / (2 * A);
  const lo = Math.max(0, t0), hi = Math.min(1, t1);
  return lo < hi ? [lo, hi] : null;
}

/**
 * Remove the points of a stroke inside the circle (page coordinates): what is left comes back as new strokes (same
 * style), boundary points interpolated; pieces under 2 points are dropped. A circle that misses returns `[s]`.
 */
export function eraseStroke(s: Stroke, center: [number, number], radius: number): Stroke[] {
  const b = bakeStroke(s), pts = b.points;
  const hits = pts.length < 2 ? pts.some((p) => Math.hypot(p[0] - center[0], p[1] - center[1]) < radius) : pts.slice(1).some((p, i) => inside(pts[i], p, center, radius));
  if (!hits) return [s];
  const out: P3[][] = [];
  let cur: P3[] | null = Math.hypot(pts[0][0] - center[0], pts[0][1] - center[1]) < radius ? null : [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], p = pts[i], iv = inside(a, p, center, radius);
    if (!iv) { if (cur) cur.push(p); else cur = [p]; continue; }
    if (iv[0] > 0 && cur) { cur.push(lerp(a, p, iv[0])); out.push(cur); cur = null; }
    if (iv[1] < 1) cur = [lerp(a, p, iv[1]), p];
    else cur = null;
  }
  if (cur) out.push(cur);
  return out.filter((q) => q.length >= 2).map((q) => strokePiece(b, q));
}
