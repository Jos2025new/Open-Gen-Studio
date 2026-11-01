import { nodeHandles, nodeSegs, type NodeType, type Seg } from './pathNodes';
import { nodePosition, pullHandle } from './nodeTypes';

/*
 * Bend mode on a node (Figma's Bend tool, ideas only): dragging a node pulls out mirrored handles so a corner becomes
 * a smooth curve (the node turns symmetric); clicking a node that has handles retracts them into a sharp corner.
 */

type P = [number, number];
const clone = (segs: Seg[]): Seg[] => segs.map((g) => ({ c: g.c, p: g.p.map((q) => [...q] as P) }));
const sticks = (q: P, at: P) => Math.hypot(q[0] - at[0], q[1] - at[1]) > 1e-9;

/** Node n with its handles set to ±(dx, dy) from it (symmetric); a node with one handle only gets it at +(dx, dy). Straight segments become curves. */
export function roundNode(segs: Seg[], n: number, dx: number, dy: number): { segs: Seg[]; type: NodeType } {
  let out = pullHandle(pullHandle(segs, n, 'out', 0, 0), n, 'in', 0, 0);
  out = clone(out);
  const h = nodeHandles(out, n), at = nodePosition(out, n), both = !!(h.in && h.out), sign = both ? -1 : 1;
  if (h.out) out[h.out[0]].p[h.out[1]] = [at[0] + dx, at[1] + dy];
  if (h.in) out[h.in[0]].p[h.in[1]] = [at[0] + sign * dx, at[1] + sign * dy];
  return { segs: out, type: both ? 'z' : 's' };
}

/** Node n retracted to a sharp corner; null when it has no handle sticking out (nothing to do). */
export function sharpenNode(segs: Seg[], n: number): Seg[] | null {
  const out = clone(segs), h = nodeHandles(out, n), at = nodePosition(out, n);
  let changed = false;
  for (const r of [h.in, h.out]) if (r && sticks(out[r[0]].p[r[1]], at)) { out[r[0]].p[r[1]] = [at[0], at[1]]; changed = true; }
  return changed && nodeSegs(out).seg[n] != null ? out : null;
}
