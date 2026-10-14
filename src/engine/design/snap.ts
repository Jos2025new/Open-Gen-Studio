import { paintModeOf } from './paintMode';
import type { DesignDoc, Layer } from '../types';
import { layerBox } from './render';

/*
 * Snap while moving a layer (Edit tool): its left, center and right edges (and top, middle, bottom) stick to the
 * page edges and center and to the same lines of the other visible layers, when within a few screen pixels. The
 * lines it sticks to come back as guides to draw. Simple on purpose: one nearest match per axis.
 */

/**
 * The snap options in effect for a document: the user's switch when they have set one; otherwise on in Design and
 * off in Drawing (paintMode.ts), where pixels are painted and snapping would only add lag.
 */
export function snapOptsFor(doc: Pick<DesignDoc, 'paintMode' | 'layers'>, byMode?: SnapByMode): SnapOptions {
  const mode = paintModeOf(doc);
  const saved = byMode?.[mode];
  return { on: mode === 'design', page: true, layers: true, guides: true, equalSpacing: true, nodes: true, ...saved };
}

/** The switches saved for each mode. Missing newer switches preserve their original on behavior. */
export type SnapByMode = { drawing?: Partial<SnapOptions>; design?: Partial<SnapOptions> };

/** How close (screen px) an edge or center must come to a target to snap: Inkscape's default object tolerance. */
export const SNAP_PX = 10;
/** The tolerance in document units at a zoom: the screen distance divided by the zoom (snap.cpp getSnapperTolerance). */
export const snapTolerance = (zoom: number): number => SNAP_PX / Math.max(1e-9, zoom);

export interface SnapOptions {
  on: boolean;
  page: boolean;
  layers: boolean;
  /** Optional for settings saved before these independent switches existed; missing means on. */
  guides?: boolean;
  equalSpacing?: boolean;
  nodes?: boolean;
}
export const SNAP_DEFAULT: SnapOptions = { on: true, page: true, layers: true, guides: true, equalSpacing: true, nodes: true };

type Box = { x: number; y: number; w: number; h: number };

/** The lines a moving box can stick to. */
export function snapTargets(doc: Pick<DesignDoc, 'width' | 'height' | 'layers' | 'guides'>, movingId: string, opts: SnapOptions): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  if (opts.page) {
    xs.push(0, doc.width / 2, doc.width);
    ys.push(0, doc.height / 2, doc.height);
  }
  if (opts.guides !== false) {
    xs.push(...(doc.guides?.x ?? []));
    ys.push(...(doc.guides?.y ?? []));
  }
  if (opts.layers) {
    for (const l of doc.layers) {
      if (l.id === movingId || !l.visible) continue;
      const b = layerBox(l as Layer);
      if (!b) continue;
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
  }
  return { xs, ys };
}

/** Above this pointer speed (px/ms) snapping waits: a fast drag is not pulled onto lines (Inkscape: tool-base.cpp:1605). */
export const SNAP_SPEED = 0.02;
/** A watchdog: after this long without a slower motion, snap anyway (Inkscape's delayed snap timer). */
export const SNAP_IDLE_MS = 150;

/** Whether to snap at this moment: when the pointer is slow, or when it has been quiet long enough. */
export function snapNow(speedPxPerMs: number, idleMs: number): boolean {
  return speedPxPerMs <= SNAP_SPEED || idleMs >= SNAP_IDLE_MS;
}

/** Weight of the pointer against the snap distance: Inkscape's snapweight, 0.5 by default (snapped-point.cpp:367). */
export const SNAP_WEIGHT = 0.5;

/**
 * Score of one candidate on one axis; the lowest score wins (snapped-point.cpp:381-386): the pointer distance and the
 * snap distance, each normalised (the pointer by the closest candidate's distance + 1, the snap by the tolerance,
 * capped at 50), mixed with weight w.
 */
export function snapScore(c: { snapDist: number; pointerDist: number }, minPointer: number, tol: number, w = SNAP_WEIGHT): number {
  return (w * c.pointerDist) / (minPointer + 1) + ((1 - w) * c.snapDist) / Math.min(50, tol);
}

/**
 * How much to nudge the box so one of its edges or its centre meets a target within `threshold`, and where. One
 * winner per axis, by snapScore; `pointer` is where the pointer is (default: the box centre).
 */
export function snapBox(box: Box, targets: { xs: number[]; ys: number[] }, threshold: number, pointer?: { x: number; y: number }): { dx: number; dy: number; gx?: number; gy?: number } {
  const px = pointer?.x ?? box.x + box.w / 2, py = pointer?.y ?? box.y + box.h / 2;
  const pick = (own: number[], lines: number[], at: number) => {
    const cands = [] as Array<{ d: number; t: number; snapDist: number; pointerDist: number }>;
    for (const o of own) for (const t of lines) {
      const d = t - o;
      if (Math.abs(d) <= threshold) cands.push({ d, t, snapDist: Math.abs(d), pointerDist: Math.abs(t - at) });
    }
    if (!cands.length) return null;
    const minP = Math.min(...cands.map((c) => c.pointerDist));
    let best = cands[0], bestS = snapScore(best, minP, threshold);
    for (const c of cands.slice(1)) {
      const sc = snapScore(c, minP, threshold);
      if (sc < bestS || (sc === bestS && c.snapDist < best.snapDist)) { best = c; bestS = sc; }
    }
    return best;
  };
  const x = pick([box.x, box.x + box.w / 2, box.x + box.w], targets.xs, px);
  const y = pick([box.y, box.y + box.h / 2, box.y + box.h], targets.ys, py);
  return { dx: x?.d ?? 0, dy: y?.d ?? 0, ...(x ? { gx: x.t } : {}), ...(y ? { gy: y.t } : {}) };
}

/** A measured gap to show: from one point to another, with its length (document units). */
export interface Measure { a: [number, number]; b: [number, number]; label: number }

/** Equal spacing by comparing local adjacent gaps. Reference gaps may be in other visible rows/columns. */
export function equalSpacing(box: Box, others: Box[], tol: number, axis: 'x' | 'y'): { d: number; measures: Measure[] } | null {
  const span = (b: Box, along: 'x' | 'y' = axis): [number, number] => (along === 'x' ? [b.x, b.x + b.w] : [b.y, b.y + b.h]);
  const cross = (b: Box, along: 'x' | 'y' = axis): [number, number] => (along === 'x' ? [b.y, b.y + b.h] : [b.x, b.x + b.w]);
  const [m0, m1] = span(box), mw = m1 - m0;
  const overlaps = (a: Box, b: Box, along: 'x' | 'y' = axis) => { const [lo, hi] = cross(a, along), [otherLo, otherHi] = cross(b, along); return hi >= otherLo && otherHi >= lo; };
  const center = (b: Box) => { const [lo, hi] = span(b), [cl, ch] = cross(b); return [(lo + hi) / 2, (cl + ch) / 2] as const; };
  // SnapSession already caps boxes to the visible viewport. Keep only the twelve nearest to this drag before comparing
  // directional neighbors; never build an all-document pair list.
  const mc = center(box);
  const near = others.slice().sort((a, b) => {
    const ac = center(a), bc = center(b);
    return Math.hypot(ac[0] - mc[0], ac[1] - mc[1]) - Math.hypot(bc[0] - mc[0], bc[1] - mc[1]);
  }).slice(0, 12);
  const local = new Set(near);
  type Gap = { a: Box; b: Box; size: number; axis: 'x' | 'y' };
  const gaps: Gap[] = [];
  for (const gapAxis of ['x', 'y'] as const) {
    for (const a of near) {
      const [, end] = span(a, gapAxis);
      const b = others.filter((candidate) => candidate !== a && span(candidate, gapAxis)[0] >= end && overlaps(a, candidate, gapAxis))
        .sort((p, q) => span(p, gapAxis)[0] - span(q, gapAxis)[0])[0];
      if (!b || !local.has(b)) continue;
      const size = span(b, gapAxis)[0] - end;
      if (size > 0) gaps.push({ a, b, size, axis: gapAxis });
    }
  }
  type Winner = { d: number; a: Box; b: Box; gap: number; gapAxis: 'x' | 'y'; neighbor?: Box; repeated: boolean };
  let best: Winner | null = null;
  const consider = (candidate: Winner) => {
    if (Math.abs(candidate.d) <= tol && (!best || Math.abs(candidate.d) < Math.abs(best.d))) best = candidate;
  };
  const sameGap = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, a, b);
  const [bandLo, bandHi] = cross(box);
  const movingBand = near.filter((o) => { const [lo, hi] = cross(o); return hi >= bandLo && lo <= bandHi; });
  for (const { a, b, size: gap, axis: gapAxis } of gaps) {
    const [a0, a1] = span(a, gapAxis), [, b1] = span(b, gapAxis);
    // The original three-box behavior remains for a reference pair in the moving box's band.
    if (gapAxis === axis && overlaps(a, box, axis) && overlaps(b, box, axis)) {
      if (gap > mw) consider({ d: (a1 + (gap - mw) / 2) - m0, a, b, gap, gapAxis, repeated: false });
      consider({ d: b1 + gap - m0, a, b, gap, gapAxis, repeated: false });
      consider({ d: a0 - gap - mw - m0, a, b, gap, gapAxis, repeated: false });
    }
    // A locally adjacent gap in another row/column can match the moving box's gap to one visible neighbor.
    for (const neighbor of movingBand) {
      // The three-box branch above owns a shared band; at a touching projection, an endpoint may be the next neighbor.
      if (gapAxis === axis && (neighbor === a || neighbor === b) && overlaps(a, box, axis) && overlaps(b, box, axis)) continue;
      const [n0, n1] = span(neighbor);
      for (const d of [n0 - gap - mw - m0, n1 + gap - m0]) {
        const start = m0 + d, end = start + mw;
        if (near.some((other) => other !== neighbor && start < span(other)[1] && end > span(other)[0])) continue;
        consider({ d, a, b, gap, gapAxis, neighbor, repeated: true });
      }
    }
  }
  if (!best) return null;
  const { d, a, b, gap, neighbor, repeated } = best;
  const moved = axis === 'x' ? { ...box, x: box.x + d } : { ...box, y: box.y + d };
  const measure = (left: Box, right: Box, along: 'x' | 'y'): Measure => {
    const [leftLo, leftHi] = cross(left, along), [rightLo, rightHi] = cross(right, along);
    const across = (Math.max(leftLo, rightLo) + Math.min(leftHi, rightHi)) / 2;
    const [, leftEnd] = span(left, along), [rightStart] = span(right, along);
    return along === 'x'
      ? { a: [leftEnd, across], b: [rightStart, across], label: rightStart - leftEnd }
      : { a: [across, leftEnd], b: [across, rightStart], label: rightStart - leftEnd };
  };
  let measures: Measure[];
  if (repeated && neighbor) {
    measures = [...gaps.filter((candidate) => sameGap(candidate.size, gap)).map((candidate) => measure(candidate.a, candidate.b, candidate.axis)),
      ...(span(moved)[0] < span(neighbor)[0] ? [measure(moved, neighbor, axis)] : [measure(neighbor, moved, axis)])];
  } else {
    const trio = [a, moved, b].sort((p, q) => span(p)[0] - span(q)[0]);
    measures = [measure(trio[0], trio[1], axis), measure(trio[1], trio[2], axis)];
  }
  return { d, measures };
}
