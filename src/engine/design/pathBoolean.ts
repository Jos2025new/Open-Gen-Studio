import { ClipType, EndType, FillRule, JoinType, PolyTree64, area as pathArea, areaPaths, booleanOpWithPolyTree, inflatePaths, union } from 'clipper2-ts';
import type { Path64, Paths64 } from 'clipper2-ts';
import { fitSubpaths } from './curveFit';
import type { Pt, Seg } from './pathNodes';

/*
 * Boolean operations on filled areas (union, difference, intersection, xor), eraser bands, knife cuts and the planar
 * arrangement a Shape Builder needs. Everything is in page coordinates and none of it throws: degenerate input gives
 * [] (or the input itself when "nothing happened" is the honest answer; each function says which).
 *
 * Pipeline: flatten the curves (adaptive, flatness <= tol) -> Clipper2 (integer grid, SCALE units per px, so results are
 * exact and never leave hairline gaps) -> PolyTree (outer + holes) -> cubic refit (curveFit.ts) -> a few curves again.
 * Structure ideas (thin-strip knife, band eraser, incremental overlay for faces, tidy after boolean) follow vectorcraft
 * (crates/pathops/src/pathfinder.rs, planar/shape_builder.rs, crates/engine/src/cmd/draw2/cut.rs; MIT OR Apache-2.0).
 * Clipper2 (Angus Johnson, BSL-1.0) via the clipper2-ts package.
 */

export type Area = { segs: Seg[]; fillRule?: 'nonzero' | 'evenodd' };
export interface BooleanOptions { /** Flatten tolerance in px. Default 0.1. */ tol?: number; /** Refit tolerance in px. Default 0.25. */ fitTol?: number }
type Op = 'union' | 'difference' | 'intersection' | 'xor';
type Comp = Paths64; // [outer, ...holes]; outer has positive area, holes negative

const SCALE = 1000;
const CT: Record<Op, ClipType> = { union: ClipType.Union, difference: ClipType.Difference, intersection: ClipType.Intersection, xor: ClipType.Xor };
const NZ = FillRule.NonZero;
/** Components with an outer smaller than SLIVER * tol^2 (px^2) are noise from the grid, not shapes. */
const SLIVER = 4;
/** Knife strip width (px) and the closing distance mergeFaces uses to bridge it. */
const KNIFE_W = 0.05;
export const MAX_FACE_AREAS = 64;
const MAX_FACE_VERTS = 20000;
const MAX_FACES = 400;

// ---------------------------------------------------------------- flatten

/** Curves to polylines: adaptive subdivision, every point of the curve within `tol` of the result. Open and closed subpaths. */
export function flatten(segs: Seg[], tol: number): Array<{ points: Pt[]; closed: boolean }> {
  const out: Array<{ points: Pt[]; closed: boolean }> = [];
  try {
    const t = Number.isFinite(tol) && tol > 0 ? tol : 0.1;
    let cur: Pt[] = [];
    let start: Pt | null = null;
    const flush = (closed: boolean) => {
      if (closed && cur.length > 1) { const a = cur[0], b = cur[cur.length - 1]; if (a[0] === b[0] && a[1] === b[1]) cur.pop(); }
      if (cur.length > 1 || (cur.length === 1 && closed)) out.push({ points: cur, closed });
      cur = [];
    };
    for (const s of segs ?? []) {
      if (s.c === 'M') { flush(false); const p = s.p[0]; if (!p) continue; start = p; cur = [p]; }
      else if (s.c === 'Z') { flush(true); if (start) cur = [start]; }
      else if (s.c === 'L') { if (!cur.length && start) cur = [start]; for (const p of s.p) cur.push(p); }
      else if (s.c === 'C') {
        if (!cur.length && start) cur = [start];
        const p0 = cur[cur.length - 1];
        if (!p0 || s.p.length < 3) continue;
        cubic(p0, s.p[0], s.p[1], s.p[2], t, 0, cur);
      }
    }
    if (cur.length > 1) flush(false);
  } catch { /* never throw */ }
  return out.map((s) => ({ points: s.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])), closed: s.closed }));
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number, depth: number, out: Pt[]): void {
  const dx = p3[0] - p0[0], dy = p3[1] - p0[1], l = Math.hypot(dx, dy);
  const d = (p: Pt) => (l < 1e-9 ? Math.hypot(p[0] - p0[0], p[1] - p0[1]) : Math.abs((p[0] - p0[0]) * dy - (p[1] - p0[1]) * dx) / l);
  if (depth >= 14 || 0.75 * Math.max(d(p1), d(p2)) <= tol) { out.push(p3); return; }
  const m = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const a = m(p0, p1), b = m(p1, p2), c = m(p2, p3), ab = m(a, b), bc = m(b, c), mid = m(ab, bc);
  cubic(p0, a, ab, mid, tol, depth + 1, out);
  cubic(mid, bc, c, p3, tol, depth + 1, out);
}

// ---------------------------------------------------------------- Clipper plumbing

const toP64 = (pts: Pt[]): Path64 => pts.map((p) => ({ x: Math.round(p[0] * SCALE), y: Math.round(p[1] * SCALE) }));
const fromP64 = (p: Path64): Pt[] => p.map((q) => [q.x / SCALE, q.y / SCALE]);
const rule = (a: Area) => (a.fillRule === 'evenodd' ? FillRule.EvenOdd : NZ);
const minArea = (tol: number) => SLIVER * tol * tol * SCALE * SCALE;

/** An Area as clean non-overlapping polygons (its own fill rule resolved). */
function normalize(a: Area, tol: number): Paths64 {
  const paths = flatten(a?.segs ?? [], tol).filter((s) => s.points.length >= 3).map((s) => toP64(s.points));
  return paths.length ? union(paths, rule(a)) : [];
}
const normalizeAll = (areas: Area[], tol: number): Paths64 => {
  const ps = (areas ?? []).flatMap((a) => normalize(a, tol));
  return ps.length > 1 ? union(ps, NZ) : ps;
};

/** Connected pieces of a PolyTree: each outer with its holes; islands inside holes are pieces of their own. */
function components(tree: PolyTree64, min: number): Comp[] {
  const out: Comp[] = [];
  const walk = (node: PolyTree64 | ReturnType<PolyTree64['child']>) => {
    for (let i = 0; i < node.count; i++) {
      const c = node.child(i);
      if (c.isHole) { walk(c); continue; }
      const outer = c.poly;
      if (!outer || outer.length < 3) { walk(c); continue; }
      const big = Math.abs(pathArea(outer)) >= min;
      const comp: Comp = [pathArea(outer) < 0 ? [...outer].reverse() : outer];
      for (let j = 0; j < c.count; j++) {
        const h = c.child(j), hp = h.poly;
        if (hp && hp.length >= 3 && Math.abs(pathArea(hp)) >= min) comp.push(pathArea(hp) > 0 ? [...hp].reverse() : hp);
        walk(h);
      }
      if (big) out.push(comp);
    }
  };
  walk(tree);
  return out;
}

function pieces(op: Op, subject: Paths64, clip: Paths64, min: number): Comp[] {
  if (!subject.length && !clip.length) return [];
  const tree = new PolyTree64();
  booleanOpWithPolyTree(CT[op], subject.length ? subject : null, clip.length ? clip : null, tree, NZ);
  return components(tree, min);
}

/** Refit a piece: outer + holes -> a few cubics (lines where it is straight). */
function fitComp(c: Comp, fitTol: number): Seg[] {
  return fitSubpaths(c.map((p) => ({ points: fromP64(p), closed: true })), { tolerance: fitTol });
}
/** The polygons as plain M/L/Z (no refit): exact, for thin strips and faces. */
function rawSegs(ps: Paths64): Seg[] {
  const out: Seg[] = [];
  for (const p of ps) {
    if (p.length < 3) continue;
    const pts = fromP64(p);
    out.push({ c: 'M', p: [pts[0]] }, ...pts.slice(1).map((q): Seg => ({ c: 'L', p: [q] })), { c: 'Z', p: [] });
  }
  return out;
}

const opts = (o?: BooleanOptions) => ({ tol: o?.tol && o.tol > 0 ? o.tol : 0.1, fitTol: o?.fitTol && o.fitTol > 0 ? o.fitTol : 0.25 });

// ---------------------------------------------------------------- boolean

/**
 * Union / difference / intersection / xor of two sets of areas (each set is first united, each Area with its own fill
 * rule). Holes survive (outer positive, hole negative orientation, so both fill rules paint them right). The result is
 * refitted to a few cubics and slivers are dropped. Degenerate input never throws: empty operands behave as the empty set.
 */
export function booleanOp(op: Op, subjects: Area[], clips: Area[], o?: BooleanOptions): Seg[] {
  try {
    const { tol, fitTol } = opts(o);
    const comps = pieces(op, normalizeAll(subjects, tol), normalizeAll(clips, tol), minArea(tol));
    return comps.flatMap((c) => fitComp(c, fitTol));
  } catch { return []; }
}

/** Connected filled pieces of a shape (outer contour + the holes inside it). Even-odd by default: holes are holes. Not refitted twice: segs are re-flattened at 0.1 px. */
export function splitComponents(segs: Seg[], fillRule: 'nonzero' | 'evenodd' = 'evenodd'): Seg[][] {
  try {
    const paths = normalize({ segs, fillRule }, 0.1);
    return pieces('union', paths, [], minArea(0.1)).map((c) => fitComp(c, 0.25));
  } catch { return []; }
}

// ---------------------------------------------------------------- eraser and knife

/** Polygons of the swept band (round caps and joins). A single point (or a stationary trail) is a circle. */
function bandPaths(trail: Pt[], radius: number): Paths64 {
  const pts = (trail ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length || !(radius > 0) || !Number.isFinite(radius)) return [];
  const dedup = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (dedup.length === 1) {
    const [cx, cy] = dedup[0], e = Math.min(0.05, radius / 2);
    const n = Math.max(12, Math.min(256, Math.ceil(Math.PI / Math.acos(1 - e / radius))));
    return [toP64(Array.from({ length: n }, (_, i): Pt => [cx + radius * Math.cos((2 * Math.PI * i) / n), cy + radius * Math.sin((2 * Math.PI * i) / n)]))];
  }
  return inflatePaths([toP64(dedup)], radius * SCALE, JoinType.Round, EndType.Round, 2, Math.min(0.05, radius / 2) * SCALE);
}

/** The area swept by a round brush of `radius` along `trail`, as closed curves. One point -> a circle; bad input -> []. */
export function eraseBand(trail: Pt[], radius: number): Seg[] {
  try { return pieces('union', bandPaths(trail, radius), [], 0).flatMap((c) => fitComp(c, 0.1)); } catch { return []; }
}

/** A hairline strip (default 0.05 px wide, flat ends) along a polyline, as exact M/L/Z polygons. Fewer than 2 distinct points -> []. */
export function knifeStrip(line: Pt[], width = KNIFE_W): Seg[] {
  try { return rawSegs(stripPaths(line, width)); } catch { return []; }
}
function stripPaths(line: Pt[], width = KNIFE_W): Paths64 {
  const pts = (line ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const dedup = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (dedup.length < 2) return [];
  const w = Number.isFinite(width) && width > 0 ? width : KNIFE_W;
  return inflatePaths([toP64(dedup)], Math.max(1, (w / 2) * SCALE), JoinType.Round, EndType.Butt, 2, 0.02 * SCALE);
}

/**
 * The area minus the brush trail, split into connected pieces (a band across a shape gives 2 pieces; rubbing only
 * inside gives 1 piece with a hole). Nothing touched -> [area.segs] (same reference); everything erased -> [].
 */
export function eraseArea(area: Area, trail: Pt[], radius: number, o?: BooleanOptions): Seg[][] {
  try {
    const { tol, fitTol } = opts(o);
    const subj = normalize(area, tol), band = bandPaths(trail, radius);
    if (!subj.length || !band.length) return [area?.segs ?? []];
    const comps = pieces('difference', subj, band, minArea(tol));
    const before = Math.abs(areaPaths(subj)), after = comps.reduce((s, c) => s + Math.abs(areaPaths(c)), 0);
    if (comps.length && Math.abs(before - after) < 1 && comps.length === 1 && comps[0].length === subj.length) return [area.segs];
    return comps.map((c) => fitComp(c, fitTol));
  } catch { return [area?.segs ?? []]; }
}

/**
 * Divide the area along a polyline. Returns the closed filled pieces (>= 2). If the line does not go through the
 * shape (a miss, or only a notch from the edge) it returns [area.segs], the same reference, so callers can detect it.
 * Pieces can be cut again: call it on each piece. The cut leaves a 0.05 px gap, as vectorcraft's knife does.
 */
export function knifeArea(area: Area, line: Pt[], o?: BooleanOptions): Seg[][] {
  try {
    const { tol, fitTol } = opts(o);
    const subj = normalize(area, tol), strip = stripPaths(line);
    if (!subj.length || !strip.length) return [area?.segs ?? []];
    const comps = pieces('difference', subj, strip, minArea(tol));
    return comps.length < 2 ? [area.segs] : comps.map((c) => fitComp(c, fitTol));
  } catch { return [area?.segs ?? []]; }
}

// ---------------------------------------------------------------- faces (Shape Builder)

const facePolys = new WeakMap<Seg[], Paths64>();

/**
 * Planar arrangement of the areas: every region that is covered by the same set of areas, as connected faces with
 * the indices of the areas ("sources") that cover them. Open-path `cutters` divide faces they cross completely.
 * Incremental overlay: faces = [A0]; for each next B every face f becomes f∩B (+B) and f−B, plus B − union(previous).
 * Cost: n areas make at most O(n^2) faces in practice (2^n worst case) and one Clipper pass per face per area, so it is
 * meant for a handful of selected shapes. Budget: more than 64 areas, 20000 flattened vertices or 400 faces -> null
 * ("too complex"). Areas outside the budget never throw; bad input gives [].
 */
export function faces(areas: Area[], cutters: Pt[][] = [], o?: BooleanOptions): Array<{ segs: Seg[]; sources: number[] }> | null {
  try {
    const { tol, fitTol } = opts(o);
    if ((areas?.length ?? 0) > MAX_FACE_AREAS) return null;
    const norm = (areas ?? []).map((a) => normalize(a, tol));
    if (norm.reduce((n, ps) => n + ps.reduce((m, p) => m + p.length, 0), 0) > MAX_FACE_VERTS) return null;
    const min = minArea(tol);
    let list: Array<{ comp: Comp; src: number[] }> = [];
    let covered: Paths64 = [];
    for (let i = 0; i < norm.length; i++) {
      const b = norm[i];
      if (!b.length) continue;
      const next: typeof list = [];
      for (const f of list) {
        for (const comp of pieces('intersection', f.comp, b, min)) next.push({ comp, src: [...f.src, i] });
        for (const comp of pieces('difference', f.comp, b, min)) next.push({ comp, src: f.src });
      }
      for (const comp of covered.length ? pieces('difference', b, covered, min) : pieces('union', b, [], min)) next.push({ comp, src: [i] });
      covered = covered.length ? union([...covered, ...b], NZ) : b;
      list = next;
      if (list.length > MAX_FACES) return null;
    }
    for (const c of cutters ?? []) {
      const strip = stripPaths(c);
      if (!strip.length) continue;
      list = list.flatMap((f) => { const parts = pieces('difference', f.comp, strip, min); return parts.length > 1 ? parts.map((comp) => ({ comp, src: f.src })) : [f]; });
      if (list.length > MAX_FACES) return null;
    }
    return list.map((f) => { const segs = fitComp(f.comp, fitTol); facePolys.set(segs, f.comp); return { segs, sources: f.src }; });
  } catch { return []; }
}

/**
 * Union of chosen faces without seams. Uses the exact polygons the faces came from (not the refitted curves, which
 * would leave hairline gaps), unites them and closes gaps up to the knife width. Foreign Seg[] are flattened instead.
 * Result is refitted; an empty list gives [].
 */
export function mergeFaces(parts: Seg[][], o?: BooleanOptions): Seg[] {
  try {
    const { tol, fitTol } = opts(o);
    const paths = (parts ?? []).flatMap((s) => facePolys.get(s) ?? normalize({ segs: s }, tol));
    if (!paths.length) return [];
    const united = union(paths, NZ);
    const d = (KNIFE_W * 0.75) * SCALE;
    const closed = inflatePaths(inflatePaths(united, d, JoinType.Miter, EndType.Polygon, 4), -d, JoinType.Miter, EndType.Polygon, 4);
    return pieces('union', closed.length ? closed : united, [], minArea(tol)).flatMap((c) => fitComp(c, fitTol));
  } catch { return []; }
}
