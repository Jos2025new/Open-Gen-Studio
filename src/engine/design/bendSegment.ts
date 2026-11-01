import type { Seg } from './pathNodes';

/*
 * Bend mode (figcraft, MIT/Apache): grab a segment at parameter t and the curve passes through the pointer p.
 * t is clamped to [0.05, 0.95]; k = 3t(1−t); off = (p − lerp(a,b,t)) / k; c1 = a + (b−a)/3 + off; c2 = b + (a−b)/3 + off.
 * The new control points are the thirds of the chord moved by `off`, so the Bézier at t sits exactly on p.
 */
type P = [number, number];

export function bendControls(a: P, b: P, t0: number, p: P): { c1: P; c2: P } {
  const t = Math.min(0.95, Math.max(0.05, t0)), k = 3 * t * (1 - t);
  const ox = (p[0] - (a[0] + (b[0] - a[0]) * t)) / k, oy = (p[1] - (a[1] + (b[1] - a[1]) * t)) / k;
  return {
    c1: [a[0] + (b[0] - a[0]) / 3 + ox, a[1] + (b[1] - a[1]) / 3 + oy],
    c2: [b[0] + (a[0] - b[0]) / 3 + ox, b[1] + (a[1] - b[1]) / 3 + oy],
  };
}

/** Segment i (ending at a node) of `segs` bent through `target` at t; a line becomes a curve. Other segments untouched. */
export function bendSegment(segs: Seg[], i: number, t: number, target: P): Seg[] {
  const out = segs.map((g) => ({ c: g.c, p: g.p.map((q) => [...q] as P) }));
  const s = out[i], prev = out[i - 1];
  if (!prev || (s.c !== 'L' && s.c !== 'C')) return out;
  const a = prev.p[prev.p.length - 1], b = s.p[s.p.length - 1], { c1, c2 } = bendControls(a, b, t, target);
  s.c = 'C';
  s.p = [c1, c2, b];
  return out;
}
