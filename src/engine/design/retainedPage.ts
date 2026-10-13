import type { FxOp, FxLayer } from '../fx/types';
import type { FxStep } from '../fx/plan';
import type { Layer } from '../types';
import type { Box } from './doc';

/*
 * Retained page (Paso 3): the editor keeps the last composite and recomposes only the region a change dirties.
 * This module holds the pure parts: FX margins (how far an op reaches beyond its pixels) and rectangle arithmetic.
 * The state and the frame logic are in this file below; `render.ts` only calls into it.
 */

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export const EMPTY: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
export const isEmpty = (r: Rect) => r.x1 <= r.x0 || r.y1 <= r.y0;
export const union = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a || isEmpty(a)) return b && !isEmpty(b) ? b : null;
  if (!b || isEmpty(b)) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
};
/** Grows a rectangle by `m` on every side (`Infinity` is the whole plane, used to force a full frame). */
export const grow = (r: Rect, m: number): Rect => (m === Infinity ? { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity } : { x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m });
/** Clips a rectangle to the page of W×H pixels. */
export const clipTo = (r: Rect, W: number, H: number): Rect => ({ x0: Math.max(0, Math.floor(r.x0)), y0: Math.max(0, Math.floor(r.y0)), x1: Math.min(W, Math.ceil(r.x1)), y1: Math.min(H, Math.ceil(r.y1)) });

/**
 * How many pixels beyond its own area an FX op can change, at composition scale. Ops that only change pixels in
 * place (tone and colour) reach nothing; blur, shadow and glow spread; anything not known here is `Infinity`, which
 * makes the frame a full one (the safe answer).
 */
export function fxMargin(op: Pick<FxOp, 'kind' | 'enabled' | 'params'>, scale: number): number {
  if (!op.enabled) return 0;
  const n = (k: string, d: number) => Number(op.params[k] ?? d);
  switch (op.kind) {
    case 'brightness': case 'contrast': case 'saturation': case 'hue': case 'grayscale': case 'sepia': case 'invert': case 'levels': case 'curves':
      return 0;
    case 'blur':
      return Math.ceil(3 * n('radius', 4) * scale);
    case 'shadow':
      return Math.ceil((Math.max(Math.abs(n('x', 8)), Math.abs(n('y', 8))) + 3 * n('blur', 12)) * scale);
    default:
      // glow reaches its blur radius (3 sigma) but its passes are not verified here; flare places light anywhere.
      return Infinity;
  }
}

/** One step of the FX plan as the planner sees it: what it is made of (identities and pixel versions), its area and its reach. */
export interface StepSig {
  below: boolean;
  key: unknown[];
  box: Rect | null;
  margin: number;
  /** Stable pixel-source identity, render properties and pixel versions distinguish paint from geometry/FX edits. */
  source?: unknown[];
  render?: unknown[];
  versions?: unknown[];
  dirty?: Rect | null;
}
/** What a frame was composed from. A new frame is compared with the last composed one. */
export interface FrameMemo { W: number; H: number; scale: number; background: string | null | undefined; fontEpoch: number; base: Rect | null; steps: StepSig[] }
export type FramePlan = { kind: 'same' } | { kind: 'full'; why: string } | { kind: 'region'; rect: Rect; reach: number };

/** Sum of the reach of FX ops (`Infinity` if any op is not known). */
function marginOf(fxs: FxLayer[], scale: number): number {
  let m = 0;
  for (const f of fxs) for (const op of f.ops) m += fxMargin(op, scale);
  return m;
}

const transformKey = (l: Layer): unknown[] => l.transform ? [...l.transform] : [];
const fxKey = (fxs: FxLayer[]): unknown[] => fxs.flatMap((fx) => [
  fx.id, fx.scope, fx.visible, fx.opacity,
  ...fx.ops.flatMap((op) => [op.id, op.kind, op.enabled, ...Object.keys(op.params).sort().flatMap((key) => [key, op.params[key]])]),
]);

/** Properties that change the raster's placement or how its pixels composite, without walking editable content. */
function renderKeyOf(layer: Layer, fxs: FxLayer[]): unknown[] {
  if (layer.type !== 'raster') return [layer, ...fxKey(fxs)];
  return [layer.id, layer.type, layer.x, layer.y, layer.width, layer.height, layer.pxWidth, layer.pxHeight,
    layer.visible, layer.opacity, layer.blend, ...transformKey(layer), layer.paintBaseId ?? null, ...fxKey(fxs)];
}

/** The planner's view of a step. A layer's box grows by its own FX reach, since its FX may spread it. */
export function stepSig(
  s: FxStep,
  scale: number,
  boxOf: (l: Layer) => Rect | null,
  versionsOf: (l: Layer) => unknown[],
  dirtyOf: (l: Layer) => Rect | null = () => null,
): StepSig {
  if (s.t === 'below') return { below: true, key: [s.fx], box: null, margin: marginOf([s.fx], scale) };
  const versions = versionsOf(s.layer), dirty = dirtyOf(s.layer);
  const fx = s.t === 'clip' ? s.fx : [];
  const render = renderKeyOf(s.layer, fx), source = s.layer.type === 'raster' ? [s.layer.id, s.layer.paintBaseId ?? null] : [s.layer];
  if (s.t === 'draw') return { below: false, key: [...render, ...versions], source, render, versions, box: boxOf(s.layer), margin: 0, dirty };
  const margin = marginOf(s.fx, scale), box = boxOf(s.layer);
  const localBox = Number.isFinite(margin) ? box && grow(box, margin) : box;
  const localDirty = dirty && (Number.isFinite(margin) ? grow(dirty, margin) : localBox);
  return { below: false, key: [...render, ...versions], source: s.layer.type === 'raster' ? [s.layer.id, s.layer.paintBaseId ?? null] : source, render, versions, box: localBox, margin, dirty: localDirty };
}

const sameKey = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((k, i) => k === b[i]);
const sameRect = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1);
function changedArea(prev: StepSig, cur: StepSig): Rect | null {
  const pixelsOnly = !!prev.source && !!cur.source && !!prev.versions && !!cur.versions
    && !!prev.render && !!cur.render && sameKey(prev.source, cur.source) && sameKey(prev.render, cur.render)
    && !sameKey(prev.versions, cur.versions);
  if (pixelsOnly && cur.dirty && !isEmpty(cur.dirty)) return cur.dirty;
  return union(union(prev.box, cur.box), union(prev.dirty, cur.dirty));
}
/** A region bigger than this share of the page is recomposed as a whole: the bookkeeping would cost more than it saves. */
export const MAX_REGION_SHARE = 0.5;

/**
 * Decides how to produce a frame from the last composed one. Only steps whose keys changed are looked at. A changed
 * layer dirties its old and new area; a 'below' FX dirties everything under it (the page when there is a background)
 * grown by its reach, and every later 'below' FX sees what the earlier changes dirtied. Anything unknown is a full frame.
 */
export function planFrame(prev: FrameMemo | null, cur: FrameMemo): FramePlan {
  if (!prev) return { kind: 'full', why: 'first frame' };
  if (prev.W !== cur.W || prev.H !== cur.H || prev.scale !== cur.scale || prev.background !== cur.background || prev.fontEpoch !== cur.fontEpoch) return { kind: 'full', why: 'page' };
  if (prev.steps.length !== cur.steps.length || prev.steps.some((p, i) => p.below !== cur.steps[i].below)) return { kind: 'full', why: 'steps' };
  // A box can change without the key changing: that is a change too.
  const changed = cur.steps.map((s, i) => !sameKey(s.key, prev.steps[i].key) || !sameRect(s.box, prev.steps[i].box));
  if (!changed.some(Boolean)) return { kind: 'same' };
  let reach = 0;
  for (const s of cur.steps) if (s.below) reach += s.margin;
  if (!Number.isFinite(reach)) return { kind: 'full', why: 'unknown FX' };
  let dirty: Rect | null = null, beneath: Rect | null = cur.base;
  for (let i = 0; i < cur.steps.length; i++) {
    const s = cur.steps[i], p = prev.steps[i];
    if (s.below) {
      // Both reaches: a shrinking blur still changed what the wider one spread over.
      const reach = Math.max(p.margin, s.margin);
      if (changed[i] || dirty) {
        const src = changed[i] ? union(beneath, dirty) : dirty;
        if (src) dirty = union(dirty, grow(src, reach));
      }
      beneath = beneath && grow(beneath, reach);
    } else {
      const box = union(p.box, s.box);
      if (changed[i]) dirty = union(dirty, changedArea(p, s));
      beneath = union(beneath, box);
    }
  }
  if (!dirty) return { kind: 'full', why: 'no area' };
  const rect = clipTo(dirty, cur.W, cur.H);
  if (isEmpty(rect)) return { kind: 'full', why: 'outside the page' };
  if ((rect.x1 - rect.x0) * (rect.y1 - rect.y0) > MAX_REGION_SHARE * cur.W * cur.H) return { kind: 'full', why: 'large region' };
  return { kind: 'region', rect, reach };
}

/** The operations a page needs from its canvas type: compose a crop (null = the whole page) and copy a part of one into another. */
export interface PageOps<C> {
  compose(crop: Rect | null): C;
  blit(dst: C, src: C, from: Rect, to: Rect): void;
}

/**
 * The composed page, kept between frames. Each frame is planned against the last one; a region is recomposed on a
 * crop that adds the FX reach around it, so the pixels inside the region match a whole-page composition.
 */
export class RetainedPage<C> {
  private memo: FrameMemo | null = null;
  private page: C | null = null;
  /** Frames by kind since the last reset (for the bench). */
  readonly stats: { same: number; region: number; full: number; fullWhy: Record<string, number> } = { same: 0, region: 0, full: 0, fullWhy: {} };
  lastPlan: FramePlan | null = null;
  reset(): void { this.memo = null; this.page = null; }
  frame(cur: FrameMemo, ops: PageOps<C>): C {
    const plan = planFrame(this.memo, cur);
    this.lastPlan = plan;
    if (plan.kind === 'same' && this.page) { this.stats.same++; return this.page; }
    if (plan.kind === 'region' && this.page) {
      const crop = clipTo(grow(plan.rect, plan.reach), cur.W, cur.H), r = plan.rect;
      const part = ops.compose(crop);
      ops.blit(this.page, part, { x0: r.x0 - crop.x0, y0: r.y0 - crop.y0, x1: r.x1 - crop.x0, y1: r.y1 - crop.y0 }, r);
      this.memo = cur; this.stats.region++;
      return this.page;
    }
    this.page = ops.compose(null);
    this.memo = cur; this.stats.full++;
    if (plan.kind === 'full') this.stats.fullWhy[plan.why] = (this.stats.fullWhy[plan.why] ?? 0) + 1;
    return this.page;
  }
}

/** The effective painted area in canvas px. Callers use the layer placement only when pixel bounds are unavailable. */
export function paintArea(l: Layer, scale: number, boxOf: (l: Layer) => Box | null): Rect | null {
  const box = boxOf(l);
  return box && { x0: box.x * scale, y0: box.y * scale, x1: (box.x + box.w) * scale, y1: (box.y + box.h) * scale };
}
