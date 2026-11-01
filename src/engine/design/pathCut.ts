import type { Pt, Seg } from './pathNodes';

/*
 * Pure geometry for cutting a path (node-edit "cut" modes). Works on our path representation: Seg[] (M L C Z, page
 * coordinates, pathNodes.ts). Each subpath is read as a contour of edges (lines and cubics, an implicit closing line
 * included); cuts and erased ranges become "breaks" between pieces, and the pieces are written back as open paths.
 * Algorithm after figcraft's vectoredit ops (split_segment / cut_segment / cut_across), reimplemented.
 */

export interface Edge { p0: Pt; c1: Pt; c2: Pt; p3: Pt; line: boolean; /** index in the source Seg[] */ idx: number }
export interface Contour { edges: Edge[]; closed: boolean }
export interface PathHit { segmentIndex: number; t: number; point: Pt; distance: number }

const EPS = 1e-9;
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const near = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/** de Casteljau: the cubic cut at t into two cubics that join at the cut point. */
export function splitCubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): [[Pt, Pt, Pt, Pt], [Pt, Pt, Pt, Pt]] {
  const a = lerp(p0, c1, t), b = lerp(c1, c2, t), c = lerp(c2, p3, t);
  const d = lerp(a, b, t), e = lerp(b, c, t), m = lerp(d, e, t);
  return [[p0, a, d, m], [m, e, c, p3]];
}

export function edgePoint(e: Edge, t: number): Pt {
  if (e.line) return lerp(e.p0, e.p3, t);
  const u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return [w0 * e.p0[0] + w1 * e.c1[0] + w2 * e.c2[0] + w3 * e.p3[0], w0 * e.p0[1] + w1 * e.c1[1] + w2 * e.c2[1] + w3 * e.p3[1]];
}

function splitEdge(e: Edge, t: number): [Edge, Edge] {
  if (e.line) {
    const m = lerp(e.p0, e.p3, t);
    return [{ ...e, p3: m, c1: e.p0, c2: m }, { ...e, p0: m, c1: m, c2: e.p3 }];
  }
  const [l, r] = splitCubic(e.p0, e.c1, e.c2, e.p3, t);
  return [{ ...e, p0: l[0], c1: l[1], c2: l[2], p3: l[3] }, { ...e, p0: r[0], c1: r[1], c2: r[2], p3: r[3] }];
}

/** The part of an edge between t0 and t1. */
function subEdge(e: Edge, t0: number, t1: number): Edge {
  const right = t0 > 0 ? splitEdge(e, t0)[1] : e;
  return t1 < 1 ? splitEdge(right, (t1 - t0) / (1 - t0))[0] : right;
}

/** Subpaths of a path as contours (a lone M has no edges and is left out). */
export function contoursOf(segs: Seg[]): Contour[] {
  const out: Contour[] = [];
  let cur: Contour | null = null, pos: Pt = [0, 0], start: Pt = [0, 0];
  const edge = (p3: Pt, idx: number, c?: [Pt, Pt]): Edge => ({ p0: pos, c1: c ? c[0] : pos, c2: c ? c[1] : p3, p3, line: !c, idx });
  segs.forEach((s, i) => {
    if (s.c === 'M') { cur = { edges: [], closed: false }; out.push(cur); pos = start = s.p[0]; return; }
    if (!cur) return;
    if (s.c === 'Z') {
      if (!near(pos, start)) cur.edges.push(edge(start, i));
      cur.closed = true; pos = start; return;
    }
    const end = s.p[s.p.length - 1];
    cur.edges.push(s.c === 'C' ? edge(end, i, [s.p[0], s.p[1]]) : edge(end, i));
    pos = end;
  });
  return out.filter((c) => c.edges.length > 0);
}

export function contourSegs(edges: Edge[], closed: boolean): Seg[] {
  const out: Seg[] = [{ c: 'M', p: [edges[0].p0] }];
  for (const e of edges) out.push(e.line ? { c: 'L', p: [e.p3] } : { c: 'C', p: [e.c1, e.c2, e.p3] });
  if (closed) out.push({ c: 'Z', p: [] });
  return out;
}

/** An edge with the parameter ranges [a, b] taken out (a = b is a plain cut); null marks each break. */
export function carve(e: Edge, ranges: Array<[number, number]>): Array<Edge | null> {
  const out: Array<Edge | null> = [];
  let at = 0;
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    if (a - at > EPS) out.push(subEdge(e, at, a));
    out.push(null);
    at = Math.max(at, b);
  }
  if (1 - at > EPS) out.push(subEdge(e, at, 1));
  return out;
}

/** Items (edges and breaks, in contour order) as open paths; a closed contour with a break is opened at it. */
export function assemble(items: Array<Edge | null>, closed: boolean): Seg[][] {
  if (!items.includes(null)) return items.length ? [contourSegs(items as Edge[], closed)] : [];
  let list = items;
  if (closed) { const i = items.indexOf(null); list = [...items.slice(i + 1), ...items.slice(0, i + 1)]; }
  const paths: Seg[][] = [];
  let run: Edge[] = [];
  for (const it of [...list, null]) {
    if (it) { run.push(it); continue; }
    if (run.length) paths.push(contourSegs(run, false));
    run = [];
  }
  return paths;
}

/** Cuts (edge index within the contour, t) applied to a contour. */
function cutContour(c: Contour, cuts: Array<{ edge: number; t: number }>): Seg[][] {
  const items = c.edges.flatMap((e, i) => carve(e, cuts.filter((k) => k.edge === i).map((k) => [k.t, k.t] as [number, number])));
  return assemble(items, c.closed);
}

/** Cut the path at parameter t of segment `segmentIndex` (index in `path`). Other subpaths come back untouched. */
export function cutPathAt(path: Seg[], segmentIndex: number, t: number): Seg[][] {
  // Nothing to cut returns the path itself (see cutPathAcross).
  if (!contoursOf(path).some((c) => c.edges.some((e) => e.idx === segmentIndex))) return [path];
  return contoursOf(path).flatMap((c) => {
    const edge = c.edges.findIndex((e) => e.idx === segmentIndex);
    return edge < 0 ? [contourSegs(c.edges, c.closed)] : cutContour(c, [{ edge, t: Math.min(1, Math.max(0, t)) }]);
  });
}

/** Parameters t in (0,1) where edge `e` crosses the segment a→b (b-side parameter u in [0,1]). */
function crossings(e: Edge, a: Pt, b: Pt): number[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  if (len2 < EPS) return [];
  const f = (t: number) => { const p = edgePoint(e, t); return dx * (p[1] - a[1]) - dy * (p[0] - a[0]); };
  const out: number[] = [], N = 32;
  let t0 = 0, f0 = f(0);
  for (let i = 1; i <= N; i++) {
    const t1 = i / N, f1 = f(t1);
    if ((f0 < 0 && f1 >= 0) || (f0 > 0 && f1 <= 0)) {
      let lo = t0, hi = t1, flo = f0;
      for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2, fm = f(m); if ((fm < 0) === (flo < 0) && fm !== 0) { lo = m; flo = fm; } else hi = m; }
      const t = (lo + hi) / 2, p = edgePoint(e, t), u = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
      if (u >= 0 && u <= 1 && t > 0.01 && t < 0.99 && !out.some((o) => Math.abs(o - t) < 1e-6)) out.push(t);
    }
    t0 = t1; f0 = f1;
  }
  return out;
}

/** Cut the path wherever the segment a→b crosses it (crossings within 0.01..0.99 of an edge). */
export function cutPathAcross(path: Seg[], a: Pt, b: Pt): Seg[][] {
  // A line that misses returns the path itself: nothing is rewritten, so no undo step and no lost node types.
  if (!contoursOf(path).some((c) => c.edges.some((e) => crossings(e, a, b).length))) return [path];
  return contoursOf(path).flatMap((c) => {
    const cuts = c.edges.flatMap((e, edge) => crossings(e, a, b).map((t) => ({ edge, t })));
    return cuts.length ? cutContour(c, cuts) : [contourSegs(c.edges, c.closed)];
  });
}

/** Closest point of the path to `point` (segmentIndex is an index in `path`), or null for an empty path. */
export function nearestOnPath(path: Seg[], point: Pt): PathHit | null {
  let best: PathHit | null = null;
  const dist = (e: Edge, t: number) => { const p = edgePoint(e, t); return Math.hypot(p[0] - point[0], p[1] - point[1]); };
  for (const c of contoursOf(path)) for (const e of c.edges) {
    const N = 32;
    let bi = 0, bd = Infinity;
    for (let i = 0; i <= N; i++) { const d = dist(e, i / N); if (d < bd) { bd = d; bi = i; } }
    let lo = Math.max(0, (bi - 1) / N), hi = Math.min(1, (bi + 1) / N);
    for (let k = 0; k < 40; k++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (dist(e, m1) < dist(e, m2)) hi = m2; else lo = m1;
    }
    const t = (lo + hi) / 2, d = dist(e, t);
    if (!best || d < best.distance) best = { segmentIndex: e.idx, t, point: edgePoint(e, t), distance: d };
  }
  return best;
}
