import type { DesignDoc, Layer } from '../types';
import { layerBox } from './render';

/*
 * Snap while moving a layer (Edit tool): its left, center and right edges (and top, middle, bottom) stick to the
 * page edges and center and to the same lines of the other visible layers, when within a few screen pixels. The
 * lines it sticks to come back as guides to draw. Simple on purpose: one nearest match per axis.
 */

/** How close (screen px) an edge or center must come to a target to snap: Inkscape's default object tolerance. */
export const SNAP_PX = 10;
/** The tolerance in document units at a zoom: the screen distance divided by the zoom (snap.cpp getSnapperTolerance). */
export const snapTolerance = (zoom: number): number => SNAP_PX / Math.max(1e-9, zoom);

export interface SnapOptions {
  on: boolean;
  page: boolean;
  layers: boolean;
}
export const SNAP_DEFAULT: SnapOptions = { on: true, page: true, layers: true };

type Box = { x: number; y: number; w: number; h: number };

/** The lines a moving box can stick to. */
export function snapTargets(doc: Pick<DesignDoc, 'width' | 'height' | 'layers' | 'guides'>, movingId: string, opts: SnapOptions): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  if (opts.page) {
    xs.push(0, doc.width / 2, doc.width);
    ys.push(0, doc.height / 2, doc.height);
  }
  // The user's own guides always count while snapping is on.
  xs.push(...(doc.guides?.x ?? []));
  ys.push(...(doc.guides?.y ?? []));
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
