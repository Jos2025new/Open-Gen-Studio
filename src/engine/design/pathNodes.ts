import type { ShapeSpec } from '../types';
import { mapPathShape, parsePath } from './path';

/*
 * Node editing of a path shape (Inkscape's Node tool, N): every segment end is a node; a cubic's two control points
 * are the handles of the nodes on each side (quadratics are read as the same cubic). Dragging a node carries its
 * handles; dragging a handle moves only it (a cusp node). The path is edited in page coordinates and written back
 * as a plain path whose own box is where it sits (path.ts mapPathShape), so it moves, scales and exports as before.
 */

type Pt = [number, number];
/** One absolute command; S, Q and T become C (Inkscape edits every curve as a cubic), so every control point drags. */
export interface Seg { c: 'M' | 'L' | 'C' | 'Z'; p: Pt[] }
/** A draggable point: a node (segment end) or a handle (control point `k` of segment `seg`). */
export interface NodePoint { kind: 'node' | 'handle'; seg: number; k: number; at: Pt; /** handle: the node it hangs from */ from?: Pt }

const ARGS: Record<string, number> = { M: 2, L: 2, T: 2, C: 6, S: 4, Q: 4, Z: 0 };

export function parseSegs(d: string): Seg[] {
  const t = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: Seg[] = [];
  let i = 0, cmd = '', cur: Pt = [0, 0], start: Pt = [0, 0], prevCtrl: Pt | null = null, prevKind = '';
  while (i < t.length) {
    if (/[A-Za-z]/.test(t[i])) { cmd = t[i++]; if (cmd === 'Z') { out.push({ c: 'Z', p: [] }); cur = start; prevKind = 'Z'; continue; } }
    const n = ARGS[cmd] ?? 0;
    if (!n) break;
    const v = t.slice(i, i + n).map(Number), pts: Pt[] = [];
    for (let k = 0; k < n; k += 2) pts.push([v[k], v[k + 1]]);
    i += n;
    const refl = (c: Pt | null): Pt => (c ? [2 * cur[0] - c[0], 2 * cur[1] - c[1]] : cur);
    if (cmd === 'M') { out.push({ c: 'M', p: pts }); start = pts[0]; cmd = 'L'; prevCtrl = null; }
    else if (cmd === 'L') { out.push({ c: 'L', p: pts }); prevCtrl = null; }
    else if (cmd === 'C') { out.push({ c: 'C', p: pts }); prevCtrl = pts[1]; }
    else if (cmd === 'S') { const c1 = refl(prevKind === 'C' ? prevCtrl : null); out.push({ c: 'C', p: [c1, ...pts] }); prevCtrl = pts[0]; cmd = 'S'; }
    else if (cmd === 'Q' || cmd === 'T') {
      // Quadratics become the same cubic (exact degree elevation), as Inkscape edits every curve: each end gets
      // its own handle, so moving a node carries its handle like any other.
      const q: Pt = cmd === 'Q' ? pts[0] : refl(prevKind === 'Q' ? prevCtrl : null), end = pts[pts.length - 1];
      out.push({ c: 'C', p: [[cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], [end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1])], end] });
      prevCtrl = q;
    }
    prevKind = cmd === 'Q' || cmd === 'T' ? 'Q' : out[out.length - 1].c;
    cur = pts[pts.length - 1];
  }
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
export function serializeSegs(segs: Seg[]): string {
  return segs.map((s) => [s.c, ...s.p.flatMap(([x, y]) => [r2(x), r2(y)])].join(' ')).join(' ');
}

/** The path's segments in page coordinates. */
export function pageSegs(s: ShapeSpec): Seg[] {
  return parseSegs(mapPathShape(s, (x, y) => [x, y]).d ?? '');
}

/** Nodes and handles to draw and drag (handles hang from the node they shape). */
export function nodePoints(segs: Seg[]): NodePoint[] {
  const out: NodePoint[] = [];
  let prevEnd: Pt | null = null;
  segs.forEach((s, i) => {
    if (s.c === 'Z' || !s.p.length) return;
    const end = s.p[s.p.length - 1];
    if (s.c === 'C') {
      if (prevEnd) out.push({ kind: 'handle', seg: i, k: 0, at: s.p[0], from: prevEnd });
      out.push({ kind: 'handle', seg: i, k: 1, at: s.p[1], from: end });
    }
    // A closing segment that lands on its subpath's start is the same node: drawn once (the M).
    if (!(closesOnStart(segs, i))) out.push({ kind: 'node', seg: i, k: s.p.length - 1, at: end });
    prevEnd = end;
  });
  return out;
}

/** The M that starts the subpath segment `i` belongs to. */
function subpathStart(segs: Seg[], i: number): number {
  for (let j = i; j >= 0; j--) if (segs[j].c === 'M') return j;
  return 0;
}
/** Segment `i` ends where its subpath began and a Z follows: the closing duplicate of the start node. */
function closesOnStart(segs: Seg[], i: number): boolean {
  if (segs[i + 1]?.c !== 'Z' || segs[i].c === 'M') return false;
  const a = segs[i].p[segs[i].p.length - 1], b = segs[subpathStart(segs, i)].p[0];
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

/** Move one node or handle by (dx, dy). A node carries its handles (and its closing twin on a closed subpath). */
export function moveNodePoint(segs: Seg[], pt: Pick<NodePoint, 'kind' | 'seg' | 'k'>, dx: number, dy: number, types?: NodeType[]): Seg[] {
  const out = segs.map((s) => ({ c: s.c, p: s.p.map((q) => [...q] as Pt) }));
  const shift = (i: number, k: number) => { const q = out[i]?.p[k]; if (q) { q[0] += dx; q[1] += dy; } };
  if (pt.kind === 'handle') {
    shift(pt.seg, pt.k);
    // A smooth node keeps its other handle in line (its own length); a symmetric one mirrors it (Inkscape).
    const node = handleNode(segs, pt.seg, pt.k), type = node != null ? types?.[node] : undefined;
    if (node != null && (type === 's' || type === 'z')) {
      const h = nodeHandles(segs, node), mine = pt.seg === h.in?.[0] && pt.k === h.in?.[1] ? h.in : h.out, other = mine === h.in ? h.out : h.in;
      if (mine && other) {
        const at = nodeAt(out, node), m = out[mine[0]].p[mine[1]], o = out[other[0]].p[other[1]];
        const dm = Math.hypot(m[0] - at[0], m[1] - at[1]);
        if (dm > 1e-9) {
          const len = type === 'z' ? dm : Math.hypot(o[0] - at[0], o[1] - at[1]);
          o[0] = at[0] - ((m[0] - at[0]) / dm) * len; o[1] = at[1] - ((m[1] - at[1]) / dm) * len;
        }
      }
    }
    return out;
  }
  const carry = (i: number) => {
    const s = out[i];
    shift(i, s.p.length - 1);
    if (s.c === 'C') shift(i, 1);
    if (out[i + 1]?.c === 'C') shift(i + 1, 0);
  };
  carry(pt.seg);
  // The start of a closed subpath: its closing twin (and the handle into it) move too.
  if (out[pt.seg].c === 'M') {
    for (let j = pt.seg + 1; j < out.length && out[j].c !== 'M'; j++) if (closesOnStart(segs, j)) { const s = out[j]; shift(j, s.p.length - 1); if (s.c === 'C') shift(j, 1); }
  }
  return out;
}

/** The shape with these segments (page coordinates): a plain path whose own box is where it sits. */
export function withSegs<T extends ShapeSpec>(s: T, segs: Seg[]): T {
  // A turned path (rot about its box centre): editing a node moves the centre, which would shift every other node on
  // the page. Shifting the own coordinates by t = (L − I)(C′ − C) keeps every untouched node exactly where it was.
  if (s.rot) {
    const r0 = parsePath(serializeSegs(segs));
    if (!('error' in r0)) {
      const [a, b, c, dd] = s.rot, C = [s.x + s.w / 2, s.y + s.h / 2], C2 = [r0.box.x + r0.box.w / 2, r0.box.y + r0.box.h / 2];
      const ex = C2[0] - C[0], ey = C2[1] - C[1], tx = (a - 1) * ex + c * ey, ty = b * ex + (dd - 1) * ey;
      segs = segs.map((g) => ({ c: g.c, p: g.p.map(([x, y]) => [x + tx, y + ty] as Pt) }));
    }
  }
  const d = serializeSegs(segs), r = parsePath(d);
  if ('error' in r) return s;
  const box = { x: r.box.x, y: r.box.y, w: Math.max(1, r.box.w), h: Math.max(1, r.box.h) };
  return { ...s, d, box0: box, ...box };
}

/*
 * Node types (Inkscape's Node tool: Shift+C cusp, Shift+S smooth, Shift+Y symmetric), stored as Inkscape stores them
 * in sodipodi:nodetypes (path-manipulator.cpp _createTypeString, L1642–1654): one letter per node and subpath, and on
 * a closed subpath the first node's letter once more at the end. Missing or unknown letters read as cusp; Inkscape's
 * 'a' (auto) reads as smooth.
 */
export type NodeType = 'c' | 's' | 'z';

/** The segment each node ends (in node order, closing twins left out), and the subpaths' node ranges. */
export function nodeSegs(segs: Seg[]): { seg: number[]; subpaths: Array<{ from: number; to: number; closed: boolean }> } {
  const seg: number[] = [], subpaths: Array<{ from: number; to: number; closed: boolean }> = [];
  segs.forEach((g, i) => {
    if (g.c === 'M') subpaths.push({ from: seg.length, to: seg.length, closed: false });
    if (g.c === 'Z') { if (subpaths.length) subpaths[subpaths.length - 1].closed = true; return; }
    if (!closesOnStart(segs, i)) { seg.push(i); if (subpaths.length) subpaths[subpaths.length - 1].to = seg.length; }
  });
  return { seg, subpaths };
}

export function readTypes(segs: Seg[], s?: string): NodeType[] {
  const { seg, subpaths } = nodeSegs(segs), out: NodeType[] = [];
  let i = 0;
  for (const sp of subpaths) {
    for (let n = sp.from; n < sp.to; n++) { const ch = s?.[i++]; out.push(ch === 's' || ch === 'a' ? 's' : ch === 'z' ? 'z' : 'c'); }
    if (sp.closed) i++;
  }
  return out.length === seg.length ? out : seg.map(() => 'c');
}

export function writeTypes(segs: Seg[], types: NodeType[]): string {
  return nodeSegs(segs).subpaths.map((sp) => types.slice(sp.from, sp.to).join('') + (sp.closed ? types[sp.from] ?? 'c' : '')).join('');
}

/** Where node `n` sits. */
function nodeAt(segs: Seg[], n: number): Pt {
  const i = nodeSegs(segs).seg[n], g = segs[i];
  return g.p[g.p.length - 1];
}

/** A node's two handles as [segment, point]: in (end of the curve into it) and out (start of the curve out). */
export function nodeHandles(segs: Seg[], n: number): { in?: [number, number]; out?: [number, number] } {
  const i = nodeSegs(segs).seg[n], out: { in?: [number, number]; out?: [number, number] } = {};
  if (segs[i].c === 'C') out.in = [i, 1];
  if (segs[i].c === 'M') { for (let j = i + 1; j < segs.length && segs[j].c !== 'M'; j++) if (closesOnStart(segs, j) && segs[j].c === 'C') out.in = [j, 1]; }
  if (segs[i + 1]?.c === 'C') out.out = [i + 1, 0];
  return out;
}

/** The node a handle hangs from. */
function handleNode(segs: Seg[], i: number, k: number): number | null {
  const ns = nodeSegs(segs).seg;
  let j = k === 1 ? i : i - 1;
  if (k === 1 && closesOnStart(segs, i)) j = subpathStart(segs, i);
  const n = ns.indexOf(j);
  return n < 0 ? null : n;
}

/** Make node `n` cusp, smooth (handles in line) or symmetric (in line and of equal length), as Inkscape does. */
export function setNodeType(segs: Seg[], n: number, type: NodeType): Seg[] {
  const out = segs.map((g) => ({ c: g.c, p: g.p.map((q) => [...q] as Pt) }));
  if (type === 'c') return out;
  const h = nodeHandles(out, n);
  if (!h.in || !h.out) return out;
  const at = nodeAt(out, n), a = out[h.in[0]].p[h.in[1]], b = out[h.out[0]].p[h.out[1]];
  const la = Math.hypot(a[0] - at[0], a[1] - at[1]), lb = Math.hypot(b[0] - at[0], b[1] - at[1]);
  // The line through the node: from the in handle to the out handle.
  let dx = b[0] - a[0], dy = b[1] - a[1];
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return out;
  dx /= d; dy /= d;
  const len = type === 'z' ? (la + lb) / 2 : 0;
  a[0] = at[0] - dx * (len || la); a[1] = at[1] - dy * (len || la);
  b[0] = at[0] + dx * (len || lb); b[1] = at[1] + dy * (len || lb);
  return out;
}
