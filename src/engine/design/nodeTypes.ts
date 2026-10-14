import { nodeHandles, nodeSegs, type NodeType, type Seg } from './pathNodes';

/*
 * Node types as Inkscape applies them (path-manipulator / node.cpp): corner (independent handles), smooth (the two
 * handles on one line, each keeping its own length) and symmetric (on one line and of equal length). Converting a
 * node rewrites its handles at once: the line follows the bisector of the two handles, and a handle that has no
 * length gets a third of the neighbouring segment. A node on a straight segment has no handle there; pulling one out
 * (Shift-drag) turns that segment into a curve.
 */

type P = [number, number];

const clone = (segs: Seg[]): Seg[] => segs.map((g) => ({ c: g.c, p: g.p.map((q) => [...q] as P) }));
const endOf = (s: Seg): P => s.p[s.p.length - 1];
const nodeCount = (segs: Seg[]) => nodeSegs(segs).seg.length;
/** Where node n sits. */
export const nodePosition = (segs: Seg[], n: number): P => endOf(segs[nodeSegs(segs).seg[n]]);

/** Nodes to show handles for: the selection and its neighbours (Inkscape shows the handles of selected nodes and their neighbours). */
export function focusNodes(segs: Seg[], selected: number[]): number[] {
  const count = nodeCount(segs), out = new Set<number>();
  for (const n of selected) for (const m of [n - 1, n, n + 1]) if (m >= 0 && m < count) out.add(m);
  return [...out].sort((a, b) => a - b);
}

/** Make node n corner, smooth or symmetric, rewriting its handles now. */
export function alignNode(segs: Seg[], n: number, type: NodeType): Seg[] {
  const out = clone(segs);
  if (type === 'c') return out;
  const h = nodeHandles(out, n), at = nodePosition(out, n), count = nodeCount(out);
  const prev = nodePosition(out, (n - 1 + count) % count), next = nodePosition(out, (n + 1) % count);
  // A handle that is missing (zero length) takes a third of the neighbouring segment, as Inkscape places it.
  const third = (to: P): P => [at[0] + (to[0] - at[0]) / 3, at[1] + (to[1] - at[1]) / 3];
  if (h.out && isAt(out[h.out[0]].p[h.out[1]], at)) out[h.out[0]].p[h.out[1]] = third(next);
  if (h.in && isAt(out[h.in[0]].p[h.in[1]], at)) out[h.in[0]].p[h.in[1]] = third(prev);
  if (!h.in || !h.out) return out; // a straight segment on one side: nothing to align
  const a = out[h.in[0]].p[h.in[1]], b = out[h.out[0]].p[h.out[1]];
  const ua = unit([a[0] - at[0], a[1] - at[1]]), ub = unit([b[0] - at[0], b[1] - at[1]]);
  const la = Math.hypot(a[0] - at[0], a[1] - at[1]), lb = Math.hypot(b[0] - at[0], b[1] - at[1]);
  // The tangent is perpendicular to the bisector of the two handle directions: ub - ua. Opposite handles give ub.
  let t = unit([ub[0] - ua[0], ub[1] - ua[1]]);
  if (!t[0] && !t[1]) t = unit([next[0] - prev[0], next[1] - prev[1]]);
  if (t[0] * ub[0] + t[1] * ub[1] < 0) t = [-t[0], -t[1]];
  const sym = type === 'z' ? (la + lb) / 2 : null;
  const la2 = sym ?? la, lb2 = sym ?? lb;
  out[h.in[0]].p[h.in[1]] = [at[0] - t[0] * la2, at[1] - t[1] * la2];
  out[h.out[0]].p[h.out[1]] = [at[0] + t[0] * lb2, at[1] + t[1] * lb2];
  return out;
}

/**
 * Pull a handle out of node n on one side (Shift-drag): the segment on that side becomes a curve if it was straight
 * (handles at its thirds, as Inkscape does), then the handle moves by (dx, dy).
 */
export function pullHandle(segs: Seg[], n: number, side: 'in' | 'out', dx: number, dy: number): Seg[] {
  const out = clone(segs), idx = nodeSegs(out).seg[n];
  const j = side === 'out' ? idx + 1 : idx, k = side === 'out' ? 0 : 1;
  const s = out[j];
  if (!s || (s.c !== 'L' && s.c !== 'C')) return out;
  if (s.c === 'L') {
    // The new curve starts with both handles on their nodes: the pulled one then follows the pointer from the node.
    const p0 = endOf(out[j - 1]), p3 = s.p[0];
    out[j] = { c: 'C', p: [[p0[0], p0[1]], [p3[0], p3[1]], p3] };
  }
  const q = out[j].p[k];
  q[0] += dx;
  q[1] += dy;
  return out;
}

const isAt = (q: P, at: P) => Math.abs(q[0] - at[0]) < 1e-9 && Math.abs(q[1] - at[1]) < 1e-9;
const unit = (v: P): P => { const l = Math.hypot(v[0], v[1]); return l > 1e-12 ? [v[0] / l, v[1] / l] : [0, 0]; };
