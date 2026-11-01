import { closesOnStart, nodeSegs, type NodeType, type Pt, type Seg } from './pathNodes';
import { bezierAt } from './segmentDrag';
import { flatten } from './pathBoolean';

/*
 * Selection elements of the node editor, after Blender's vertex / edge / face select (keys 1 / 2 / 3): the node
 * (vertex), the segment (the edge between two consecutive nodes, the closing one included) and the face (a closed
 * subpath; an outer contour carries the holes inside it). The selection itself stays a list of node indices
 * (ShapeEdit.nodes) so every node operation keeps working; `segs` and `faces` only say which elements those nodes
 * stand for. A segment is named by the index of the node it starts at, a face by the index of its subpath.
 * Faces are the closed subpaths; the overlap regions of a self-intersecting path (pathBoolean `faces`) are not faces.
 */
export type SelectMode = 'node' | 'segment' | 'face';
export const SELECT_MODES: SelectMode[] = ['node', 'segment', 'face'];

export interface SelEdge { id: number; a: number; b: number; /** the segment's start point and the L/C command that ends it */ from: Pt; seg: Seg }
export interface SelFace { id: number; /** its own nodes, and (outer contours) the nodes of its holes */ nodes: number[]; hole: boolean; holes: number[]; poly: Pt[]; box: { x0: number; y0: number; x1: number; y1: number }; area: number; /** own contour + holes, as drawn */ segs: Seg[] }
export interface Sel { nodes: number[]; segs: number[]; faces: number[] }

const sorted = (a: Iterable<number>): number[] => [...new Set(a)].sort((x, y) => x - y);
const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Every segment of the path (open subpaths: n-1, closed: n). */
export function edgesOf(segs: Seg[]): SelEdge[] {
  const ns = nodeSegs(segs), out: SelEdge[] = [];
  const end = (i: number): Pt => segs[i].p[segs[i].p.length - 1];
  for (const sp of ns.subpaths) {
    const m = sp.to - sp.from;
    for (let k = 0; k < m; k++) {
      const a = sp.from + k;
      if (k < m - 1) { out.push({ id: a, a, b: a + 1, from: end(ns.seg[a]), seg: segs[ns.seg[a + 1]] }); continue; }
      if (!sp.closed || m < 2) continue;
      let seg: Seg | undefined;
      for (let i = ns.seg[a] + 1; i < segs.length && segs[i].c !== 'M'; i++) if (segs[i].c !== 'Z' && closesOnStart(segs, i)) { seg = segs[i]; break; }
      const first = end(ns.seg[sp.from]);
      out.push({ id: a, a, b: sp.from, from: end(ns.seg[a]), seg: seg ?? { c: 'L', p: [first] } });
    }
  }
  return out;
}

/** Distance from `pt` to the segment, both in the space `map` leads to (screen px). */
export function edgeDistance(e: SelEdge, map: (p: Pt) => Pt, pt: Pt): number {
  const p0 = map(e.from), p3 = map(e.seg.p[e.seg.p.length - 1]);
  const at = (t: number): Pt => (e.seg.c === 'C' ? bezierAt(p0, map(e.seg.p[0]), map(e.seg.p[1]), p3, t) : [p0[0] + (p3[0] - p0[0]) * t, p0[1] + (p3[1] - p0[1]) * t]);
  const n = e.seg.c === 'C' ? 24 : 1;
  let best = Infinity, prev = at(0);
  for (let k = 1; k <= n; k++) {
    const q = at(k / n), vx = q[0] - prev[0], vy = q[1] - prev[1], len = vx * vx + vy * vy;
    const u = len ? Math.max(0, Math.min(1, ((pt[0] - prev[0]) * vx + (pt[1] - prev[1]) * vy) / len)) : 0;
    best = Math.min(best, Math.hypot(prev[0] + vx * u - pt[0], prev[1] + vy * u - pt[1]));
    prev = q;
  }
  return best;
}

/** The segment nearest to `pt` within `tol`, or null. */
export function pickEdge(edges: SelEdge[], map: (p: Pt) => Pt, pt: Pt, tol: number): SelEdge | null {
  let best: SelEdge | null = null, bd = tol;
  for (const e of edges) {
    const pts = [e.from, ...e.seg.p].map(map); // the curve stays in its control hull: skip what the pointer is clearly away from
    if (pt[0] < Math.min(...pts.map((q) => q[0])) - bd || pt[0] > Math.max(...pts.map((q) => q[0])) + bd || pt[1] < Math.min(...pts.map((q) => q[1])) - bd || pt[1] > Math.max(...pts.map((q) => q[1])) + bd) continue;
    const d = edgeDistance(e, map, pt); if (d <= bd) { bd = d; best = e; }
  }
  return best;
}

const inside = (poly: Pt[], [x, y]: Pt): boolean => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const signedArea = (poly: Pt[]): number => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const boxOf = (poly: Pt[]) => poly.reduce((b, [x, y]) => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
type Box = ReturnType<typeof boxOf>;
/** `a` lies wholly in `g`: its box is within g's and every sampled vertex is inside; overlapping contours are siblings. */
const within = (a: { poly: Pt[]; box: Box }, g: { poly: Pt[]; box: Box }): boolean =>
  a.box.x0 >= g.box.x0 && a.box.y0 >= g.box.y0 && a.box.x1 <= g.box.x1 && a.box.y1 <= g.box.y1 && a.poly.every((p) => inside(g.poly, p));

/**
 * The closed subpaths as faces. Containment needs the whole contour inside. Evenodd: an odd depth is a hole. Nonzero (the
 * default): a nested contour is a hole only if it winds against its parent (a hole itself never makes a hole); one that winds
 * the same way is a filled face of its own. An outer contour owns the holes whose smallest container it is.
 */
export function facesOf(segs: Seg[], fillRule?: 'evenodd' | 'nonzero'): SelFace[] {
  const ns = nodeSegs(segs), groups: Seg[][] = [];
  segs.forEach((g) => { if (g.c === 'M') groups.push([]); groups[groups.length - 1]?.push(g); });
  const all = ns.subpaths.map((sp, id) => {
    const poly = sp.closed && sp.to - sp.from >= 2 ? flatten(groups[id] ?? [], 0.5)[0]?.points : undefined;
    if (!poly || poly.length < 3) return null;
    const sa = signedArea(poly);
    return { id, poly, box: boxOf(poly), sa, area: Math.abs(sa), nodes: Array.from({ length: sp.to - sp.from }, (_, k) => sp.from + k), parent: -1, depth: 0, hole: false };
  }).filter((f): f is NonNullable<typeof f> => !!f);
  for (const f of all) {
    const boxes = all.filter((g) => g !== f && g.area >= f.area && within(f, g) && !(g.area === f.area && g.id > f.id)).sort((x, y) => x.area - y.area);
    f.depth = boxes.length; f.parent = boxes[0]?.id ?? -1;
  }
  for (const f of [...all].sort((x, y) => x.depth - y.depth)) {
    const par = all.find((g) => g.id === f.parent);
    f.hole = !par ? false : fillRule === 'evenodd' ? f.depth % 2 === 1 : !par.hole && Math.sign(par.sa) !== Math.sign(f.sa);
  }
  return all.map((f) => {
    const holes = f.hole ? [] : all.filter((g) => g.hole && g.parent === f.id);
    return { id: f.id, hole: f.hole, holes: holes.map((h) => h.id), poly: f.poly, box: f.box, area: f.area, nodes: sorted([...f.nodes, ...holes.flatMap((h) => h.nodes)]), segs: [f.id, ...holes.map((h) => h.id)].flatMap((i) => groups[i]) };
  });
}

/** The face under `pt` (own coordinates): the smallest contour containing it, so a click in a hole picks the hole itself. */
export function pickFace(faces: SelFace[], pt: Pt): SelFace | null {
  return faces.filter((f) => pt[0] >= f.box.x0 && pt[0] <= f.box.x1 && pt[1] >= f.box.y0 && pt[1] <= f.box.y1 && inside(f.poly, pt)).sort((a, b) => a.area - b.area)[0] ?? null;
}

const nodesOfSegs = (edges: SelEdge[], ids: number[]) => sorted(edges.filter((e) => ids.includes(e.id)).flatMap((e) => [e.a, e.b]));
const nodesOfFaces = (faces: SelFace[], ids: number[]) => sorted(faces.filter((f) => ids.includes(f.id)).flatMap((f) => f.nodes));

/** The elements `nodes` stand for in `mode`; nodes that are no whole element are dropped (Blender). */
export function deriveSel(edges: SelEdge[], faces: SelFace[], mode: SelectMode, nodes: number[]): Sel {
  const set = new Set(nodes);
  if (mode === 'segment') { const segs = edges.filter((e) => set.has(e.a) && set.has(e.b)).map((e) => e.id); return { nodes: nodesOfSegs(edges, segs), segs, faces: [] }; }
  if (mode === 'face') {
    const full = faces.filter((f) => f.nodes.every((n) => set.has(n)));
    const ids = full.filter((f) => !(f.hole && full.some((o) => o.holes.includes(f.id)))).map((f) => f.id); // a hole of a selected outer face is part of it
    return { nodes: nodesOfFaces(faces, ids), segs: [], faces: ids };
  }
  return { nodes: sorted(nodes), segs: [], faces: [] };
}

/** What is selected: the stored elements while they still match the nodes, else what the nodes stand for. */
export function effectiveSel(edges: SelEdge[], faces: SelFace[], mode: SelectMode, nodes: number[], stored?: { segs?: number[]; faces?: number[] }): Sel {
  const ns = sorted(nodes);
  if (mode === 'segment' && stored?.segs?.length) { const segs = stored.segs.filter((i) => edges.some((e) => e.id === i)); if (segs.length && same(nodesOfSegs(edges, segs), ns)) return { nodes: ns, segs, faces: [] }; }
  if (mode === 'face' && stored?.faces?.length) { const ids = stored.faces.filter((i) => faces.some((f) => f.id === i)); if (ids.length && same(nodesOfFaces(faces, ids), ns)) return { nodes: ns, segs: [], faces: ids }; }
  return deriveSel(edges, faces, mode, ns);
}

/** The selection after picking an element: Shift toggles it, a plain pick keeps a selection that already holds it. */
export function pickSel(edges: SelEdge[], faces: SelFace[], mode: SelectMode, cur: Sel, id: number, shift: boolean): Sel {
  const list = mode === 'segment' ? cur.segs : cur.faces;
  const ids = shift ? (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]) : list.includes(id) ? list : [id];
  return mode === 'segment' ? { nodes: nodesOfSegs(edges, ids), segs: ids, faces: [] } : { nodes: nodesOfFaces(faces, ids), segs: [], faces: ids };
}

/** Delete the selected faces: their subpaths, and the holes of an outer contour with it. Null when nothing is selected. */
export function deleteFaces(segs: Seg[], types: NodeType[], faces: SelFace[], ids: number[]): { segs: Seg[]; types: NodeType[] } | null {
  const drop = new Set(faces.filter((f) => ids.includes(f.id)).flatMap((f) => [f.id, ...f.holes]));
  if (!drop.size) return null;
  const ns = nodeSegs(segs), keepNode = new Set<number>(), out: Seg[] = [];
  let g = -1;
  for (const s of segs) {
    if (s.c === 'M') g++;
    if (!drop.has(g)) out.push(s);
  }
  ns.subpaths.forEach((sp, i) => { if (!drop.has(i)) for (let n = sp.from; n < sp.to; n++) keepNode.add(n); });
  return { segs: out, types: types.filter((_, n) => keepNode.has(n)) };
}
