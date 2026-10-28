import type { Layer } from '../types';
import { layerBox } from './render';
import type { Measure } from './snap';

/*
 * Distances to the neighbours while an object moves (Edit tool): on each side of the moving box (left, right, above,
 * below), the nearest visible box that overlaps it on the other axis, and the empty gap between them in document
 * units. The gaps come back as Measure lines, drawn by the same overlay as the equal-spacing cotas (SnapIndicator).
 */

type Box = { x: number; y: number; w: number; h: number };
type Axis = 'x' | 'y';

const start = (b: Box, axis: Axis) => (axis === 'x' ? b.x : b.y);
const size = (b: Box, axis: Axis) => (axis === 'x' ? b.w : b.h);
/** The range on the other axis, where two boxes must overlap to share a row (for x gaps) or a column (for y gaps). */
const cross = (b: Box, axis: Axis): [number, number] => (axis === 'x' ? [b.y, b.y + b.h] : [b.x, b.x + b.w]);

/** The nearest gap on one side along `axis`, or null when no candidate lies beyond the box on that side. */
function nearestOn(box: Box, others: Box[], axis: Axis, side: 'before' | 'after'): Measure | null {
  const [lo, hi] = cross(box, axis);
  const boxStart = start(box, axis), boxEnd = boxStart + size(box, axis);
  let best: Measure | null = null, bestGap = Infinity;
  for (const o of others) {
    const [olo, ohi] = cross(o, axis);
    if (!(olo <= hi && lo <= ohi)) continue; // no overlap on the other axis: not a neighbour of this side
    const oStart = start(o, axis), oEnd = oStart + size(o, axis);
    const gap = side === 'after' ? oStart - boxEnd : boxStart - oEnd;
    if (gap <= 0 || gap >= bestGap) continue; // overlapping, touching, or farther than the nearest so far
    const across = (Math.max(lo, olo) + Math.min(hi, ohi)) / 2;
    const at = side === 'after' ? [boxEnd, oStart] : [oEnd, boxStart];
    const pt = (main: number) => (axis === 'x' ? [main, across] : [across, main]) as [number, number];
    best = { a: pt(at[0]), b: pt(at[1]), label: Math.round(gap) };
    bestGap = gap;
  }
  return best;
}

/** The nearest gap on each side of `box` among `others`, left/above first. Labels are rounded document units. */
export function nearestGaps(box: Box, others: Box[]): Measure[] {
  const out: Measure[] = [];
  for (const axis of ['x', 'y'] as const) {
    for (const side of ['before', 'after'] as const) {
      const m = nearestOn(box, others, axis, side);
      if (m) out.push(m);
    }
  }
  return out;
}

/**
 * The gaps from `box`, moved by `by` (the snap's correction), to the visible layers that are not moving (`skip` holds
 * the ids of the moving group).
 */
export function neighbourGaps(box: Box, layers: Layer[], skip: Set<string>, by?: { dx?: number; dy?: number } | null): Measure[] {
  const others: Box[] = [];
  for (const l of layers) {
    if (skip.has(l.id) || !l.visible) continue;
    const b = layerBox(l);
    if (b) others.push(b);
  }
  return nearestGaps({ ...box, x: box.x + (by?.dx ?? 0), y: box.y + (by?.dy ?? 0) }, others);
}

/**
 * What a move does with snapping and measures. Ctrl/Meta pressed during the drag (not already held at pointerdown,
 * where it adds to the selection) turns snapping off but keeps the measures; Alt turns both off, as before.
 */
export function moveMode(snapOn: boolean, alt: boolean, ctrlNow: boolean, ctrlAtDown: boolean): { snap: boolean; measure: boolean } {
  const ctrl = ctrlNow && !ctrlAtDown;
  return { snap: snapOn && !alt && !ctrl, measure: ctrl || (snapOn && !alt) };
}
