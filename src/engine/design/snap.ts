import type { DesignDoc, Layer } from '../types';
import { layerBox } from './render';

/*
 * Snap while moving a layer (Edit tool): its left, center and right edges (and top, middle, bottom) stick to the
 * page edges and center and to the same lines of the other visible layers, when within a few screen pixels. The
 * lines it sticks to come back as guides to draw. Simple on purpose: one nearest match per axis.
 */

export interface SnapOptions {
  on: boolean;
  page: boolean;
  layers: boolean;
}
export const SNAP_DEFAULT: SnapOptions = { on: true, page: true, layers: true };

type Box = { x: number; y: number; w: number; h: number };

/** The lines a moving box can stick to. */
export function snapTargets(doc: Pick<DesignDoc, 'width' | 'height' | 'layers'>, movingId: string, opts: SnapOptions): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  if (opts.page) {
    xs.push(0, doc.width / 2, doc.width);
    ys.push(0, doc.height / 2, doc.height);
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

/** How much to nudge the box so its nearest edge or center meets a target within `threshold`; and where. */
export function snapBox(box: Box, targets: { xs: number[]; ys: number[] }, threshold: number): { dx: number; dy: number; gx?: number; gy?: number } {
  const near = (own: number[], lines: number[]) => {
    let best: { d: number; at: number } | null = null;
    for (const o of own) for (const t of lines) {
      const d = t - o;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }
    return best;
  };
  const x = near([box.x, box.x + box.w / 2, box.x + box.w], targets.xs);
  const y = near([box.y, box.y + box.h / 2, box.y + box.h], targets.ys);
  return { dx: x?.d ?? 0, dy: y?.d ?? 0, ...(x ? { gx: x.at } : {}), ...(y ? { gy: y.at } : {}) };
}
