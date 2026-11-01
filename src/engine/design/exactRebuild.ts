import { ClipType, Clipper64, FillRule, PathType, PolyTree64 } from 'clipper2-ts';
import type { Path64, Paths64, Point64 } from 'clipper2-ts';
import { fitSubpaths } from './curveFit';
import type { Pt, Seg } from './pathNodes';

/*
 * Exact curves out of a polygon boolean. The inputs are flattened as usual, but every polygon point carries a tag in
 * its Z value: which original segment it came from and at which t (a node: the end of one segment and the start of
 * the next). Clipper keeps the tag on the points it passes through and calls `cb` for each crossing it creates, which
 * gets the tags of both crossing segments. After the operation each output loop is walked: consecutive points of the
 * same original segment are ONE sub-curve of it (de Casteljau between t0 and t1; a line stays a line), and the only
 * new nodes are the crossings, refined (Newton) to the exact meeting point of the two curves. Runs that cannot be
 * mapped (a point without tag) are refitted from their polyline (curveFit.ts), so the result never fails.
 */

interface Entry { seg: number; t: number }
interface Geom { c: Pt[] } // 2 points = line, 4 = cubic
const EPS = 1e-9;

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function evalAt(g: Geom, t: number): Pt {
  let pts = g.c;
  while (pts.length > 1) pts = pts.slice(1).map((p, i) => lerp(pts[i], p, t));
  return pts[0];
}
function deriv(g: Geom, t: number): Pt {
  if (g.c.length === 2) return [g.c[1][0] - g.c[0][0], g.c[1][1] - g.c[0][1]];
  const d = [0, 1, 2].map((i): Pt => [3 * (g.c[i + 1][0] - g.c[i][0]), 3 * (g.c[i + 1][1] - g.c[i][1])]);
  const a = lerp(d[0], d[1], t), b = lerp(d[1], d[2], t);
  return lerp(a, b, t);
}
/** The cubic's control points between t0 and t1 (t0 > t1 gives it reversed). */
function sub(c: Pt[], t0: number, t1: number): Pt[] {
  const split = (p: Pt[], t: number): [Pt[], Pt[]] => {
    const a = lerp(p[0], p[1], t), b = lerp(p[1], p[2], t), d = lerp(p[2], p[3], t), ab = lerp(a, b, t), bd = lerp(b, d, t), m = lerp(ab, bd, t);
    return [[p[0], a, ab, m], [m, bd, d, p[3]]];
  };
  if (t0 > t1) return sub(c, t1, t0).reverse();
  const right = t0 > 0 ? split(c, t0)[1] : c;
  return t1 < 1 ? split(right, t0 < 1 ? (t1 - t0) / (1 - t0) : 0)[0] : right;
}

export class Tagger {
  private geoms: Geom[] = [];
  private recs: Entry[][] = [];
  private tol = 0.1;
  constructor(private scale: number) {}
  private rec(es: Entry[]): number { this.recs.push(es); return this.recs.length; }
  private entries = (p: Point64): Entry[] | undefined => (p.z ? this.recs[p.z - 1] : undefined);

  /** Closed polygons (Clipper units) for the segs, flattened to `tol`, every point tagged. */
  tag(segs: Seg[], tol: number): Paths64 {
    const out: Paths64 = [], S = this.scale;
    this.tol = Math.max(this.tol, tol);
    type P = { p: Pt; es: Entry[] };
    let pts: P[] = [];
    const same = (a: Pt, b: Pt) => Math.round(a[0] * S) === Math.round(b[0] * S) && Math.round(a[1] * S) === Math.round(b[1] * S);
    const add = (p: Pt, e: Entry) => { const q = pts[pts.length - 1]; if (q && same(q.p, p)) q.es.push(e); else pts.push({ p, es: [e] }); };
    const geom = (c: Pt[]) => { this.geoms.push({ c }); return this.geoms.length - 1; };
    const cubicT = (c: Pt[], t0: number, t1: number, id: number, depth: number) => {
      const l = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]);
      const d = (p: Pt) => (l < 1e-9 ? Math.hypot(p[0] - c[0][0], p[1] - c[0][1]) : Math.abs((p[0] - c[0][0]) * (c[3][1] - c[0][1]) - (p[1] - c[0][1]) * (c[3][0] - c[0][0])) / l);
      if (depth >= 14 || 0.75 * Math.max(d(c[1]), d(c[2])) <= tol) { add(c[3], { seg: id, t: t1 }); return; }
      const m = (a: Pt, b: Pt) => lerp(a, b, 0.5), a = m(c[0], c[1]), b = m(c[1], c[2]), e = m(c[2], c[3]), ab = m(a, b), be = m(b, e), mid = m(ab, be), tm = (t0 + t1) / 2;
      cubicT([c[0], a, ab, mid], t0, tm, id, depth + 1);
      cubicT([mid, be, e, c[3]], tm, t1, id, depth + 1);
    };
    const flush = () => {
      if (pts.length > 1 && same(pts[0].p, pts[pts.length - 1].p)) { const l = pts.pop()!; pts[0].es.push(...l.es); }
      else if (pts.length > 2) { // closing edge: a line of its own
        const id = geom([pts[pts.length - 1].p, pts[0].p]);
        pts[pts.length - 1].es.push({ seg: id, t: 0 }); pts[0].es.push({ seg: id, t: 1 });
      }
      if (pts.length >= 3) out.push(pts.map((q) => ({ x: Math.round(q.p[0] * S), y: Math.round(q.p[1] * S), z: this.rec(q.es) })));
      pts = [];
    };
    for (const s of segs ?? []) {
      if (s.c === 'M') { flush(); if (s.p[0]) pts = [{ p: s.p[0], es: [] }]; continue; }
      if (s.c === 'Z') { flush(); continue; }
      if (!pts.length) continue;
      const cur = pts[pts.length - 1].p, head = pts[pts.length - 1];
      if (s.c === 'L') {
        let from = cur, h = head;
        for (const q of s.p) { const id = geom([from, q]); h.es.push({ seg: id, t: 0 }); add(q, { seg: id, t: 1 }); from = q; h = pts[pts.length - 1]; }
      } else if (s.p.length >= 3) {
        const c = [cur, s.p[0], s.p[1], s.p[2]], id = geom(c);
        head.es.push({ seg: id, t: 0 }); cubicT(c, 0, 1, id, 0);
      }
    }
    flush();
    return out;
  }

  /** The tag of the segment both ends of an edge carry, at the point `ip` on that edge (t interpolated along the chord). */
  private along(b: Point64, t: Point64, ip: { x: number; y: number }): Entry | null {
    const rb = this.entries(b), rt = this.entries(t);
    const eb = rb?.find((x) => rt?.some((y) => y.seg === x.seg)), et = eb && rt?.find((y) => y.seg === eb.seg);
    if (!eb || !et) return null;
    const dx = t.x - b.x, dy = t.y - b.y, l2 = dx * dx + dy * dy;
    const r = l2 ? Math.max(0, Math.min(1, ((ip.x - b.x) * dx + (ip.y - b.y) * dy) / l2)) : 0;
    return { seg: eb.seg, t: eb.t + (et.t - eb.t) * r };
  }
  private cross(edges: Array<[Point64, Point64]>, ip: { x: number; y: number }): number {
    const es: Entry[] = [];
    for (const [b, t] of edges) {
      const hit = (q: Point64) => q.x === ip.x && q.y === ip.y;
      if (hit(b) || hit(t)) es.push(...(this.entries(hit(b) ? b : t) ?? []));
      else { const e = this.along(b, t, ip); if (e) es.push(e); }
    }
    return es.length ? this.rec(es.filter((e, i) => es.findIndex((f) => f.seg === e.seg && Math.abs(f.t - e.t) < 1e-6) === i)) : 0;
  }

  /** Clipper's Z callback: the crossing gets the tags of both segments (a crossing at a node keeps the node's tags too). */
  cb = (b1: Point64, t1: Point64, b2: Point64, t2: Point64, ip: Point64): void => {
    const z = this.cross([[b1, t1], [b2, t2]], ip);
    if (z) ip.z = z;
  };

  /** Adds the entries of tag `z` to the point's own tag (a vertex reached twice, a vertex touching an edge). */
  private mergeTag(q: Point64, z: number): void {
    if (!z || q.z === z) return;
    if (!q.z) { q.z = z; return; }
    const dst = this.recs[q.z - 1];
    for (const e of this.recs[z - 1]) if (!dst.some((f) => f.seg === e.seg && Math.abs(f.t - e.t) < 1e-6)) dst.push(e);
  }

  /**
   * The bounded faces of one closed polygon drawn on its own crossings (the planar arrangement of its edges), each a
   * counter-clockwise (positive area) polygon with tagged corners. A part folded back over the rest gives its own
   * faces and the cancelled overlap (winding 0) is a face too; the unbounded face is left out. Crossings, vertices that
   * touch another edge (T-junctions) and collinear overlaps all split the edges; null when the polygon is too big to search.
   */
  faces(p: Path64): Paths64 | null {
    const n = p.length, key = (q: { x: number; y: number }) => q.x + ',' + q.y;
    const on: Array<Array<{ s: number; q: Point64 }>> = Array.from({ length: n }, () => []);
    const at = new Map<string, Point64>();
    for (const q of p) { const old = at.get(key(q)); if (old) this.mergeTag(old, q.z ?? 0); else at.set(key(q), q); } // a repeated vertex keeps both tags
    const dot = (a: Point64, b: Point64, q: { x: number; y: number }) => (q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y);
    /** `v` (a vertex of the other edge) lies strictly inside edge a-b: it splits it. */
    const split = (ei: number, a: Point64, b: Point64, other: [Point64, Point64], v: Point64) => {
      const s = dot(a, b, v);
      if (s <= 0 || s >= dot(a, b, b)) return;
      const q = at.get(key(v));
      if (!q) return;
      this.mergeTag(q, this.cross([[a, b], other], { x: v.x, y: v.y }));
      on[ei].push({ s, q });
    };
    const status = edgePairs([p], (u, v) => {
      const [i, j] = u.k < v.k ? [u.k, v.k] : [v.k, u.k], a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
      const s1 = orient(a.x, a.y, b.x, b.y, c.x, c.y), s2 = orient(a.x, a.y, b.x, b.y, d.x, d.y), s3 = orient(c.x, c.y, d.x, d.y, a.x, a.y), s4 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
      if (s1 * s2 > 0 || s3 * s4 > 0) return;
      if (s1 * s2 < 0 && s3 * s4 < 0) {
        const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x), t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
        const ip = { x: Math.round(a.x + t * (b.x - a.x)), y: Math.round(a.y + t * (b.y - a.y)) }, k = key(ip), old = at.get(k), z = this.cross([[a, b], [c, d]], ip);
        if (old) this.mergeTag(old, z); // the same point reached twice (a vertex, a triple crossing): one tag
        const q: Point64 = old ?? { ...ip, z }; at.set(k, q);
        on[i].push({ s: dot(a, b, ip), q }); on[j].push({ s: dot(c, d, ip), q });
        return;
      }
      if (s1 === 0) split(i, a, b, [c, d], c);
      if (s2 === 0) split(i, a, b, [c, d], d);
      if (s3 === 0) split(j, c, d, [a, b], a);
      if (s4 === 0) split(j, c, d, [a, b], b);
    });
    if (status === 'budget') return null;
    // the graph: one node per point, one edge per distinct pair of consecutive points (overlapping edges merge into one)
    const nb = new Map<string, Point64[]>(), seen = new Set<string>(), seq: Point64[] = [];
    for (let i = 0; i < n; i++) { seq.push(at.get(key(p[i])) ?? p[i]); for (const e of on[i].sort((x, y) => x.s - y.s)) seq.push(e.q); }
    for (let i = 0; i < seq.length; i++) {
      const u = seq[i], v = seq[(i + 1) % seq.length], ku = key(u), kv = key(v);
      if (ku === kv || seen.has(ku + '|' + kv)) continue;
      seen.add(ku + '|' + kv); seen.add(kv + '|' + ku);
      (nb.get(ku) ?? nb.set(ku, []).get(ku)!).push(v); (nb.get(kv) ?? nb.set(kv, []).get(kv)!).push(u);
    }
    for (const [k, list] of nb) { const o = at.get(k)!; list.sort((x, y) => Math.atan2(x.y - o.y, x.x - o.x) - Math.atan2(y.y - o.y, y.x - o.x)); }
    const done = new Set<string>(), out: Paths64 = [];
    for (const [ku, list] of nb) for (const first of list) {
      const u0 = at.get(ku)!, face: Point64[] = [];
      let u = u0, v = first;
      while (!done.has(key(u) + '|' + key(v))) {
        done.add(key(u) + '|' + key(v)); face.push(u);
        const around = nb.get(key(v))!, i = around.findIndex((q) => key(q) === key(u));
        u = v; v = around[(i + around.length - 1) % around.length];
      }
      let a2 = 0;
      for (let i = 0; i < face.length; i++) { const q = face[i], r = face[(i + 1) % face.length]; a2 += q.x * r.y - r.x * q.y; }
      if (face.length >= 3 && a2 > 0) out.push(face);
    }
    return out;
  }

  /** Where a vertex really is: a node of the originals, else the refined meeting of two curves, else Clipper's point. */
  private posOf(v: Point64, memo: Map<number, Pt>): Pt {
    const raw: Pt = [v.x / this.scale, v.y / this.scale], es = this.entries(v);
    if (!es?.length) return raw;
    const hit = memo.get(v.z!);
    if (hit) return hit;
    let p: Pt = raw;
    const node = es.find((e) => e.t < EPS || e.t > 1 - EPS);
    if (node) p = evalAt(this.geoms[node.seg], node.t < 0.5 ? 0 : 1);
    else if (es.length >= 2 && (es[0].seg !== es[1].seg || Math.abs(es[0].t - es[1].t) > 1e-3)) {
      let a = es[0].t, b = es[1].t;
      const g1 = this.geoms[es[0].seg], g2 = this.geoms[es[1].seg];
      for (let i = 0; i < 12; i++) {
        const p1 = evalAt(g1, a), p2 = evalAt(g2, b), d1 = deriv(g1, a), d2 = deriv(g2, b);
        const rx = p2[0] - p1[0], ry = p2[1] - p1[1], det = -d1[0] * d2[1] + d2[0] * d1[1];
        if (Math.abs(det) < 1e-12) break;
        a += (-rx * d2[1] + d2[0] * ry) / det; b += (d1[0] * ry - d1[1] * rx) / det;
      }
      const q1 = evalAt(g1, a), q2 = evalAt(g2, b);
      if (a > 0 && a < 1 && b > 0 && b < 1 && Math.hypot(q1[0] - q2[0], q1[1] - q2[1]) < 1e-7 && Math.hypot(q1[0] - raw[0], q1[1] - raw[1]) < 3 * this.tol + 0.01) { es[0].t = a; es[1].t = b; p = q1; }
      else p = this.onCurve(es[0], raw);
    } else p = this.onCurve(es[0], raw);
    memo.set(v.z!, p);
    return p;
  }

  /** The original curve at the entry's t when that is near the raw point (never farther than the flattening could be), else the raw point. */
  private onCurve(e: Entry, raw: Pt): Pt {
    const q = evalAt(this.geoms[e.seg], e.t);
    return Math.hypot(q[0] - raw[0], q[1] - raw[1]) <= 3 * this.tol + 0.01 ? q : raw;
  }
  /** The parameter of the point of the segment nearest to `p`. */
  private project(g: Geom, p: Pt): number {
    if (g.c.length === 2) {
      const [a, b] = g.c, dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      return l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    }
    const d = (t: number) => { const q = evalAt(g, t); return Math.hypot(q[0] - p[0], q[1] - p[1]); };
    let best = 0, bd = Infinity;
    for (let i = 0; i <= 32; i++) { const x = d(i / 32); if (x < bd) { bd = x; best = i / 32; } }
    let lo = Math.max(0, best - 1 / 32), hi = Math.min(1, best + 1 / 32);
    for (let i = 0; i < 30; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (d(m1) < d(m2)) hi = m2; else lo = m1; }
    return (lo + hi) / 2;
  }

  /**
   * The original segment an output edge runs along: of the segments both ends carry, the one whose curve passes the edge's midpoint (a node shared by two segments that both cross the edge is ambiguous otherwise).
   * `x` and `y` are the tags of its two ends for that segment (the entries themselves: refining a crossing updates them). When the ends share no
   * segment (Clipper dropped a collinear point between them) the ends are projected onto the segments they carry.
   */
  private edge(a: Point64, b: Point64): { seg: number; x: Entry; y: Entry } | null {
    const ea = this.entries(a), eb = this.entries(b);
    if (!ea || !eb) return null;
    const mx = (a.x + b.x) / 2 / this.scale, my = (a.y + b.y) / 2 / this.scale;
    let best: { seg: number; x: Entry; y: Entry } | null = null, bd = 3 * this.tol + 0.01;
    for (const x of ea) for (const y of eb) {
      if (x.seg !== y.seg) continue;
      const q = evalAt(this.geoms[x.seg], (x.t + y.t) / 2), d = Math.hypot(q[0] - mx, q[1] - my);
      if (d <= bd) { bd = d; best = { seg: x.seg, x, y }; }
    }
    if (best) return best;
    const A: Pt = [a.x / this.scale, a.y / this.scale], B: Pt = [b.x / this.scale, b.y / this.scale], dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    for (const seg of new Set([...ea, ...eb].map((e) => e.seg))) {
      const g = this.geoms[seg], ta = this.project(g, A), tb = this.project(g, B);
      if (Math.abs(ta - tb) < EPS) continue;
      const worst = Math.max(dist(evalAt(g, ta), A), dist(evalAt(g, tb), B), dist(evalAt(g, (ta + tb) / 2), [mx, my]));
      if (worst <= bd) { bd = worst; best = { seg, x: { seg, t: ta }, y: { seg, t: tb } }; }
    }
    return best;
  }

  /** One output loop as M ... Z with exact sub-curves; unmapped stretches are refitted (tolerance `fitTol`). */
  rebuild(loop: Path64, fitTol: number): Seg[] {
    const n = loop.length, memo = new Map<number, Pt>();
    const refit = (pts: Pt[], closed: boolean) => fitSubpaths([{ points: pts, closed }], { tolerance: fitTol });
    try {
      if (n < 3) return [];
      // each edge: its original segment (or -1) and the direction of t along it
      const ed = Array.from({ length: n }, (_, i) => this.edge(loop[i], loop[(i + 1) % n]));
      const seg = ed.map((e) => (e ? e.seg : -1)), dir = ed.map((e) => (e ? Math.sign(e.y.t - e.x.t) : 0));
      // a new run where the segment changes, turns back, or jumps in t (a curve crossing itself: same segment, other branch)
      const cut = (i: number) => { const j = (i + n - 1) % n; return seg[j] !== seg[i] || (dir[j] !== 0 && dir[i] !== 0 && dir[j] !== dir[i]) || (seg[i] >= 0 && Math.abs(ed[j]!.y.t - ed[i]!.x.t) > 1e-4); };
      let k = -1;
      for (let i = 0; i < n && k < 0; i++) if (cut(i)) k = i;
      if (k < 0) return refit(loop.map((q) => [q.x / this.scale, q.y / this.scale]), true);
      const idx = (i: number) => (k + i) % n;
      const pos = (i: number) => this.posOf(loop[idx(i)], memo);
      const start = pos(0), out: Seg[] = [{ c: 'M', p: [start] }];
      let i = 0;
      while (i < n) {
        let j = i + 1;
        while (j < n && !cut(idx(j))) j++;
        const s = seg[idx(i)], end = pos(j % n);
        if (s < 0) out.push(...refit(Array.from({ length: j - i + 1 }, (_, m) => pos((i + m) % n)), false).filter((g) => g.c !== 'M'));
        else {
          const g = this.geoms[s], t0 = ed[idx(i)]!.x.t, t1 = ed[idx(j - 1)]!.y.t; // per edge: a loop crossing has two tags of one segment
          if (g.c.length === 2 || Math.abs(t1 - t0) < EPS) out.push({ c: 'L', p: [end] });
          else { const c = sub(g.c, t0, t1); out.push({ c: 'C', p: [c[1], c[2], end] }); }
        }
        i = j;
      }
      out.push({ c: 'Z', p: [] });
      return out;
    } catch { return refit(loop.map((q) => [q.x / this.scale, q.y / this.scale]), true); }
  }
}

/** Runs a Clipper operation with the tagger's Z callback; the solution as a PolyTree. */
export function runTree(tg: Tagger, ct: ClipType, subject: Paths64, clip: Paths64, rule: FillRule): PolyTree64 {
  const tree = new PolyTree64(), c = new Clipper64();
  c.zCallback = tg.cb;
  if (subject.length) c.addPaths(subject, PathType.Subject);
  if (clip.length) c.addPaths(clip, PathType.Clip);
  c.execute(ct, rule, tree);
  return tree;
}
/** Same, as flat closed polygons. */
export function runPaths(tg: Tagger, ct: ClipType, subject: Paths64, clip: Paths64, rule: FillRule): Paths64 {
  const out: Paths64 = [], c = new Clipper64();
  c.zCallback = tg.cb;
  if (subject.length) c.addPaths(subject, PathType.Subject);
  if (clip.length) c.addPaths(clip, PathType.Clip);
  c.execute(ct, rule, out);
  return out;
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
export interface EdgeRef { ci: number; k: number; ax: number; ay: number; bx: number; by: number }

/**
 * Visits every pair of non-adjacent edges whose boxes overlap (sweep over x), in the polylines `paths` (closed).
 * `visit` returns true to stop. 'stop' = stopped, 'done' = all visited, 'budget' = too many candidates (not finished).
 */
export function edgePairs(paths: Path64[], visit: (u: EdgeRef, v: EdgeRef) => boolean | void, budget = 3e6): 'stop' | 'done' | 'budget' {
  const es: EdgeRef[] = [];
  paths.forEach((p, ci) => p.forEach((a, k) => { const b = p[(k + 1) % p.length]; es.push({ ci, k, ax: a.x, ay: a.y, bx: b.x, by: b.y }); }));
  es.sort((u, v) => Math.min(u.ax, u.bx) - Math.min(v.ax, v.bx));
  let work = 0;
  for (let i = 0; i < es.length; i++) {
    const u = es[i], ux1 = Math.max(u.ax, u.bx), uy0 = Math.min(u.ay, u.by), uy1 = Math.max(u.ay, u.by);
    for (let j = i + 1; j < es.length; j++) {
      const v = es[j];
      if (Math.min(v.ax, v.bx) > ux1) break;
      if (++work > budget) return 'budget';
      if (Math.max(v.ay, v.by) < uy0 || Math.min(v.ay, v.by) > uy1) continue;
      if (u.ci === v.ci) { const m = paths[u.ci].length, dk = Math.abs(u.k - v.k); if (dk < 2 || dk === m - 1) continue; }
      if (visit(u, v) === true) return 'stop';
    }
  }
  return 'done';
}

/** Two edges of the same polyline or of different ones: 'cross' = they properly cross; 'touch' = they meet otherwise (a vertex on the other edge, shared vertex, collinear overlap). */
export function edgeRelation(u: EdgeRef, v: EdgeRef): 'cross' | 'touch' | 'none' {
  const d1 = orient(u.ax, u.ay, u.bx, u.by, v.ax, v.ay), d2 = orient(u.ax, u.ay, u.bx, u.by, v.bx, v.by);
  const d3 = orient(v.ax, v.ay, v.bx, v.by, u.ax, u.ay), d4 = orient(v.ax, v.ay, v.bx, v.by, u.bx, u.by);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 'cross';
  return d1 * d2 <= 0 && d3 * d4 <= 0 ? 'touch' : 'none';
}

const area2 = (f: Path64) => { let a2 = 0; for (let i = 0; i < f.length; i++) { const q = f[i], r = f[(i + 1) % f.length]; a2 += q.x * r.y - r.x * q.y; } return a2; };
/** Winding number of the closed polygon `p` around (x, y). */
function windAt(p: Path64, x: number, y: number): number {
  let w = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
    if (a.y <= y) { if (b.y > y && c > 0) w++; } else if (b.y <= y && c < 0) w--;
  }
  return w;
}
/** A point inside the (simple, counter-clockwise) face: the middle of its widest span on a line between two vertex heights (no vertex on it). */
function innerPoint(f: Path64): { x: number; y: number } | null {
  const ys = [...new Set(f.map((q) => q.y))].sort((a, b) => a - b);
  let best: { x: number; y: number; w: number } | null = null;
  for (let k = 0; k + 1 < ys.length; k++) {
    const y = (ys[k] + ys[k + 1]) / 2, xs: number[] = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      if ((a.y <= y) !== (b.y <= y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best.w) best = { x: (xs[i] + xs[i + 1]) / 2, y, w: xs[i + 1] - xs[i] };
  }
  return best && best.w > 0 ? best : null;
}
/**
 * Which way a contour was drawn, read from a face of its own, not from one vertex (a folded lobe can hold the lowest
 * vertex and turn the other way): the sign of the contour's winding inside the face that holds another contour of the
 * path (a ring is two opposite contours, so the hole says which face it was drawn against), else inside the largest
 * face (the body). +1 = the faces' sign (positive shoelace), -1 the other. No usable face: the net area.
 */
export function orientation(p: Path64, faces: Paths64, others: Path64[] = []): number {
  const inside = (f: Path64, q: { x: number; y: number }) => windAt(f, q.x, q.y) > 0;
  let face: Path64 | null = null;
  for (const o of others) for (const f of faces) if (o.length && inside(f, o[0]) && (!face || area2(f) > area2(face))) face = f;
  face ??= faces.reduce<Path64 | null>((m, f) => (!m || area2(f) > area2(m) ? f : m), null);
  const at = face && innerPoint(face), w = at ? windAt(p, at.x, at.y) : 0;
  return w ? Math.sign(w) : area2(p) < 0 ? -1 : 1;
}
