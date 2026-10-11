import type { ShapeSpec } from '../types';
import { mapPathShape, parsePath } from './path';

/*
 * Node editing of a path shape (Inkscape's Node tool, N): every segment end is a node; a cubic's two control points
 * are the handles of the nodes on each side, a quadratic's one control point is shared. Dragging a node carries its
 * handles; dragging a handle moves only it (a cusp node). The path is edited in page coordinates and written back
 * as a plain path whose own box is where it sits (path.ts mapPathShape), so it moves, scales and exports as before.
 */

type Pt = [number, number];
/** One absolute command; S and T are made explicit (C, Q) so every control point can be dragged. */
export interface Seg { c: 'M' | 'L' | 'C' | 'Q' | 'Z'; p: Pt[] }
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
    else if (cmd === 'Q') { out.push({ c: 'Q', p: pts }); prevCtrl = pts[0]; }
    else if (cmd === 'T') { const c1 = refl(prevKind === 'Q' ? prevCtrl : null); out.push({ c: 'Q', p: [c1, pts[0]] }); prevCtrl = c1; }
    prevKind = out[out.length - 1].c;
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
    } else if (s.c === 'Q') out.push({ kind: 'handle', seg: i, k: 0, at: s.p[0], from: end });
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
export function moveNodePoint(segs: Seg[], pt: Pick<NodePoint, 'kind' | 'seg' | 'k'>, dx: number, dy: number): Seg[] {
  const out = segs.map((s) => ({ c: s.c, p: s.p.map((q) => [...q] as Pt) }));
  const shift = (i: number, k: number) => { const q = out[i]?.p[k]; if (q) { q[0] += dx; q[1] += dy; } };
  if (pt.kind === 'handle') { shift(pt.seg, pt.k); return out; }
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
  const d = serializeSegs(segs), r = parsePath(d);
  if ('error' in r) return s;
  const box = { x: r.box.x, y: r.box.y, w: Math.max(1, r.box.w), h: Math.max(1, r.box.h) };
  return { ...s, d, box0: box, ...box };
}
