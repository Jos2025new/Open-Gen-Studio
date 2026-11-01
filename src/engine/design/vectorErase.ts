import { assemble, carve, contourSegs, contoursOf, edgePoint, type Edge } from './pathCut';
import type { Pt, Seg } from './pathNodes';

/* Vector eraser: remove the parts of a path inside a circle. Pure geometry; algorithm after figcraft's inside_ranges / erase. */

const STEPS = 64;

/** Parameter ranges of edge `e` inside the circle: sampled, boundaries bisected, narrow crossings found by nearest point. */
export function insideRanges(e: Edge, center: Pt, radius: number): Array<[number, number]> {
  const d = (t: number) => { const p = edgePoint(e, t); return Math.hypot(p[0] - center[0], p[1] - center[1]) - radius; };
  const boundary = (out: number, inn: number) => {
    for (let k = 0; k < 30; k++) { const m = (out + inn) / 2; if (d(m) < 0) inn = m; else out = m; }
    return (out + inn) / 2;
  };
  const vals = Array.from({ length: STEPS + 1 }, (_, i) => d(i / STEPS));
  const ranges: Array<[number, number]> = [];
  let start: number | null = vals[0] < 0 ? 0 : null;
  for (let i = 1; i <= STEPS; i++) {
    const a = (i - 1) / STEPS, b = i / STEPS, ina = vals[i - 1] < 0, inb = vals[i] < 0;
    if (!ina && inb) start = boundary(a, b);
    else if (ina && !inb && start != null) { ranges.push([start, boundary(b, a)]); start = null; }
    else if (!ina && !inb) {
      // Both samples outside: a narrow dip between them may still cut the circle.
      let lo = a, hi = b;
      for (let k = 0; k < 30; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (d(m1) < d(m2)) hi = m2; else lo = m1; }
      const m = (lo + hi) / 2;
      if (d(m) < 0) ranges.push([boundary(a, m), boundary(b, m)]);
    }
  }
  if (start != null) ranges.push([start, 1]);
  return ranges;
}

/** What is left of the path outside the circle: 0..n open paths (a path the circle misses comes back as is). */
export function erasePath(path: Seg[], center: Pt, radius: number): Seg[][] {
  return contoursOf(path).flatMap((c) => {
    const per = c.edges.map((e) => insideRanges(e, center, radius));
    if (!per.some((r) => r.length)) return [contourSegs(c.edges, c.closed)];
    return assemble(c.edges.flatMap((e, i) => carve(e, per[i])), c.closed);
  });
}
