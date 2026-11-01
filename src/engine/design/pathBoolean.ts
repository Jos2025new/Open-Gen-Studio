import { ClipType, EndType, FillRule, JoinType, PointInPolygonResult, PolyTree64, area as pathArea, areaPaths, booleanOpWithPolyTree, inflatePaths, pointInPolygon, union } from 'clipper2-ts';
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

// ---------------------------------------------------------------- existing components (no refit)

type Box = [number, number, number, number];
/** A connected piece as it stands: its polygons for Clipper and, when the shape's own subpaths can be told apart, its original segs (reused as they are, so untouched pieces never drift). */
interface Part { comp: Comp; box: Box; segs?: Seg[] }
const boundsOf = (ps: Paths64): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) for (const q of p) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
  return [x0, y0, x1, y1];
};
const hits = (a: Box, b: Box, m = SCALE) => a[0] <= b[2] + m && b[0] <= a[2] + m && a[1] <= b[3] + m && b[1] <= a[3] + m;
const inside = (a: Box, b: Box, m = 2) => a[0] >= b[0] - m && a[1] >= b[1] - m && a[2] <= b[2] + m && a[3] <= b[3] + m;

/**
 * The shape split into its existing components (outer + holes) by containment, keeping each one's original segs.
 * Pieces that merely touch (the two halves of a cut) stay separate; only if the nesting is not clean (overlapping
 * subpaths, a same-direction subpath inside a nonzero outer) does it fall back to uniting. Tiny pieces are kept:
 * only results of an operation are filtered.
 */
function partsOf(area: Area, tol: number): Part[] {
  const groups: Array<{ segs: Seg[]; path: Path64; box: Box; size: number; up: Group[]; parent?: Group }> = [];
  type Group = (typeof groups)[number];
  let cur: Seg[] = [];
  const push = () => { if (cur.length) { const f = flatten(cur, tol).find((x) => x.points.length >= 3); if (f) { const path = toP64(f.points); groups.push({ segs: cur, path, box: boundsOf([path]), size: pathArea(path), up: [] }); } } cur = []; };
  for (const g of area?.segs ?? []) { if (g.c === 'M') push(); cur.push(g); }
  push();
  if (!groups.length) return [];
  const evenOdd = area.fillRule === 'evenodd';
  let clean = groups.every((g) => g.size !== 0);
  for (const g of groups) for (const c of groups) {
    if (c === g || Math.abs(c.size) <= Math.abs(g.size) || !inside(g.box, c.box)) continue;
    const probe = g.path.length > 64 ? g.path.filter((_, i) => i % Math.ceil(g.path.length / 64) === 0) : g.path;
    if (probe.every((q) => pointInPolygon(q, c.path) !== PointInPolygonResult.IsOutside)) g.up.push(c);
  }
  for (const g of groups) {
    g.up.sort((a, b) => Math.abs(a.size) - Math.abs(b.size));
    g.parent = g.up[0];
    // under nonzero each nesting level winds against the one around it
    if (clean && g.parent && !evenOdd && Math.sign(g.size) === Math.sign(g.parent.size)) clean = false;
    if (clean && g.up.length > 1 && g.parent && g.up.length !== g.parent.up.length + 1) clean = false;
  }
  if (!clean) return partsByUnion(groups, area, tol);
  const outers = groups.filter((g) => g.up.length % 2 === 0);
  return outers.map((o): Part => {
    const holes = groups.filter((g) => g.parent === o && g.up.length % 2 === 1);
    const orient = (g: Group, positive: boolean) => ((g.size > 0) === positive ? g.path : [...g.path].reverse());
    const comp: Comp = [orient(o, true), ...holes.map((h) => orient(h, false))];
    return { comp, box: o.box, segs: [o, ...holes].flatMap((g) => g.segs) };
  });
}
/** The union fallback: components of the united area; each subpath goes to the smallest component whose box holds it (no original segs if one is lost). */
function partsByUnion(groups: Array<{ segs: Seg[]; path: Path64 }>, area: Area, tol: number): Part[] {
  void tol;
  const parts: Part[] = pieces('union', union(groups.map((g) => g.path), rule(area)), [], 0).map((comp) => ({ comp, box: boundsOf([comp[0]]) }));
  const own: Seg[][][] = parts.map(() => []);
  let lost = false;
  for (const g of groups) {
    const gb = boundsOf([g.path]);
    let best = -1, bestSize = Infinity;
    parts.forEach((p, i) => { const size = (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]); if (inside(gb, p.box) && size < bestSize) { best = i; bestSize = size; } });
    if (best < 0) lost = true; else own[best].push(g.segs);
  }
  if (!lost) parts.forEach((p, i) => { if (own[i].length) p.segs = own[i].flat(); });
  return parts;
}
const partSegs = (p: Part, fitTol: number): Seg[] => p.segs ?? fitComp(p.comp, fitTol);

/** Connected filled pieces of a shape (outer contour + the holes inside it), each with its own segs as they were (no flatten/refit drift). Even-odd by default: holes are holes. */
export function splitComponents(segs: Seg[], fillRule: 'nonzero' | 'evenodd' = 'evenodd'): Seg[][] {
  try { return partsOf({ segs, fillRule }, 0.1).map((p) => partSegs(p, 0.25)); } catch { return []; }
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
 * inside gives 1 piece with a hole). Only components the band can reach are recomputed; the others keep their original
 * segs. Nothing touched -> [area.segs] (same reference); everything erased -> [].
 */
export function eraseArea(area: Area, trail: Pt[], radius: number, o?: BooleanOptions): Seg[][] {
  try {
    const { tol, fitTol } = opts(o);
    const band = bandPaths(trail, radius), parts = partsOf(area, tol);
    if (!parts.length || !band.length) return [area?.segs ?? []];
    const bb = boundsOf(band), min = minArea(tol);
    let changed = false;
    const out = parts.flatMap((p) => {
      if (!hits(p.box, bb)) return [partSegs(p, fitTol)];
      const comps = pieces('difference', p.comp, band, min);
      if (comps.length === 1 && Math.abs(Math.abs(areaPaths(p.comp)) - Math.abs(areaPaths(comps[0]))) < 1) return [partSegs(p, fitTol)];
      changed = true;
      return comps.map((c) => fitComp(c, fitTol));
    });
    return changed ? out : [area.segs];
  } catch { return [area?.segs ?? []]; }
}

/**
 * Divide the area along a polyline. Returns the closed filled pieces (>= 2). If the line does not go through the
 * shape (a miss, or only a notch from the edge) it returns [area.segs], the same reference, so callers can detect it.
 * Pieces can be cut again: call it on each piece. The cut leaves a 0.05 px strip empty; each new piece then grows half
 * of it back toward the cut, so neighbours touch exactly (no anti-aliasing hairline). Components the line does not
 * divide keep their original segs.
 */
export function knifeArea(area: Area, line: Pt[], o?: BooleanOptions): Seg[][] {
  try {
    const { tol, fitTol } = opts(o);
    const strip = stripPaths(line), parts = partsOf(area, tol);
    if (!parts.length || !strip.length) return [area?.segs ?? []];
    const sb = boundsOf(strip), min = minArea(tol);
    let cut = false;
    const out = parts.flatMap((p) => {
      if (!hits(p.box, sb)) return [partSegs(p, fitTol)];
      const comps = pieces('difference', p.comp, strip, min);
      if (comps.length < 2) return [partSegs(p, fitTol)];
      cut = true;
      return comps.map((c) => fitComp(seamless(c, strip), fitTol));
    });
    return cut ? out : [area.segs];
  } catch { return [area?.segs ?? []]; }
}

/** The piece plus the half of the knife strip nearest to it: grown by half the strip width, but only inside the strip, so the rest of its outline stays put. */
function seamless(c: Comp, strip: Paths64): Paths64 {
  const grown = inflatePaths(c, (KNIFE_W / 2) * SCALE, JoinType.Miter, EndType.Polygon, 4);
  const add = pieces('intersection', grown, strip, 0).flat();
  const merged = add.length ? pieces('union', c, add, 0) : [];
  return merged.length === 1 ? merged[0] : c;
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
