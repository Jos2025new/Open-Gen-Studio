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

/**
 * Equal spacing along one axis (distribution-snapper.cpp): the box moves so that its gap to a neighbour equals the gap
 * between two other boxes, either between them (the box in the middle) or beyond them (the same gap again). Only boxes
 * in the box's band count (they overlap it across the axis); the nearest twelve are tried. Null if nothing is within tol.
 */
export function equalSpacing(box: Box, others: Box[], tol: number, axis: 'x' | 'y'): { d: number; measures: Measure[] } | null {
  const span = (b: Box): [number, number] => (axis === 'x' ? [b.x, b.x + b.w] : [b.y, b.y + b.h]);
  const cross = (b: Box): [number, number] => (axis === 'x' ? [b.y, b.y + b.h] : [b.x, b.x + b.w]);
  const [m0, m1] = span(box), mw = m1 - m0, [cLo, cHi] = cross(box);
  const band = others.filter((o) => { const [lo, hi] = cross(o); return hi >= cLo && lo <= cHi; });
  const near = band.sort((p, q) => Math.abs(span(p)[0] - m0) - Math.abs(span(q)[0] - m0)).slice(0, 12);
  let best: { d: number; a: Box; b: Box } | null = null;
  const consider = (d: number, a: Box, b: Box) => { if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, a, b }; };
  for (const A of near) for (const B of near) {
    const [a0, a1] = span(A), [b0, b1] = span(B);
    if (a1 > b0) continue; // A must lie before B
    const g = b0 - a1;
    if (g <= 0) continue;
    if (g > mw) consider((a1 + (g - mw) / 2) - m0, A, B); // between A and B
    consider((b1 + g) - m0, A, B);                         // beyond B, same gap
    consider((a0 - g - mw) - m0, A, B);                    // before A, same gap
  }
  if (!best) return null;
  const { d, a, b } = best as { d: number; a: Box; b: Box };
  const moved = axis === 'x' ? { ...box, x: box.x + d } : { ...box, y: box.y + d };
  // The three boxes in order along the axis: the gaps between consecutive ones are the measures to show.
  const across = (cLo + cHi) / 2;
  const at = (v: number): [number, number] => (axis === 'x' ? [v, across] : [across, v]);
  const trio = [a, moved, b].sort((p, q) => span(p)[0] - span(q)[0]);
  const measures: Measure[] = [];
  for (let i = 0; i + 1 < trio.length; i++) {
    const gap = span(trio[i + 1])[0] - span(trio[i])[1];
    if (gap > 1e-9) measures.push({ a: at(span(trio[i])[1]), b: at(span(trio[i + 1])[0]), label: gap });
  }
  return { d, measures };
}
