import { checkExportSize } from './exportLimits';
import { drawMaskedVector, maskContains, maskBounds } from './vectorMask';
import { apply, invert, mapBox } from './matrix';
import { pathTransform } from './path';
import { canvasToBlob, createCanvas, ctx2d } from '../../lib/media';
import type { BlendMode, DesignDoc, Layer, TextLayer, VectorLayer, VectorShape } from '../types';
import { shapeBox, unionBox, type Box } from './doc';
import { shapeMatrix } from './shapeTransform';
import { applyStrokeLook, BLUR_MARGIN, blurRegion, cornerRadii, rectBox, traceRoundRect } from './shapeLook';
import { bufferVersion, cloneCanvas, getBuffer, paintingLive, rasterBufferIds, redrawSoon } from './raster';
import { bufferAlpha } from './hitAlpha';
import { cachedBelow, keepBelow } from './belowFxCache';
import type { FxLayer } from '../fx/types';
import { drawStroke } from './brushTextures';
import { strokeBox } from './strokes';
import { rasterPaintedBox } from './rasterBounds';
import { fxPlan } from '../fx/plan';
import { paintArea, RetainedPage, type FrameMemo, type Rect } from './retainedPage';
import { rasterDirtyRect } from './rasterDirty';
import { retainedPlannerSteps } from './retainedPlanner';
import { mixFx } from '../fx/canvas';
import { frameShown, span, takeCanvasCount, traceStatus } from '../../lib/trace';

import { beginRender, type RenderOrigin, type RenderTrace } from '../../lib/renderTrace';

/* One renderer for both the editor view and exports, so what you see is what you export. */

const GCO: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'soft-light': 'soft-light',
  'hard-light': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

// Every blend the canvas and CSS mix-blend-mode share (the SVG export writes the same names): the one list of them.
export const BLEND_MODES = Object.keys(GCO) as BlendMode[];

/** Screen pixels per layer pixel from which raster layers are drawn without smoothing. */
export const PIXEL_VIEW_FROM = 4;

export { layoutText, textAscent, type TextLayout } from './textLayout';
import { applyLetterSpacing, fontFor, layoutText } from './textLayout';

export { alphaBounds, pixelBox } from './rasterBounds';

export function layerBox(l: Layer): Box | null {
  let b = untransformedBox(l);
  if (b && l.type === 'vector' && l.pixelMask) {
    const mb = maskBounds(l.pixelMask);
    if (!mb) return null;
    const x = Math.max(b.x, mb.x), y = Math.max(b.y, mb.y);
    const w = Math.min(b.x + b.w, mb.x + mb.w) - x, h = Math.min(b.y + b.h, mb.y + mb.h) - y;
    b = w > 0 && h > 0 ? { x, y, w, h } : null;
  }
  // Images and text that were rotated or skewed: the box around where they show.
  return b && l.transform && l.type !== 'vector' ? mapBox(l.transform, b) : b;
}

/** A point on the page, in the layer's own coordinates (before its transform). */
export function toLayerSpace(l: Layer, x: number, y: number): [number, number] {
  return l.transform && l.type !== 'vector' ? apply(invert(l.transform), x, y) : [x, y];
}

function untransformedBox(l: Layer): Box | null {
  switch (l.type) {
    case 'raster':
      return rasterPaintedBox(l) ?? { x: l.x, y: l.y, w: l.width, h: l.height };
    case 'vector':
      return unionBox([...l.shapes.map(shapeBox), ...(l.strokes ?? []).map(strokeBox).filter((b): b is Box => b != null)]);
    case 'text': {
      const t = layoutText(l);
      return { x: l.x, y: l.y, w: t.width, h: t.height };
    }
    case 'fx':
      return null;
  }
}

function drawShape(ctx: CanvasRenderingContext2D, s: VectorShape): void {
  if (s.blur && s.blur > 0) { drawBlurredShape(ctx, s); return; }
  ctx.save();
  paintShape(ctx, s);
  ctx.restore();
}

/** Fill and stroke of one shape (stroke style: shapeLook.ts, Inkscape's formulas). */
function paintShape(ctx: CanvasRenderingContext2D, s: VectorShape): void {
  let p: Path2D | undefined, sw = s.strokeWidth;
  if (s.type === 'path') {
    if (!s.d) return;
    const t = pathTransform(s);
    // A converted shape keeps its turn (shapeTransform.ts), outside the path's own placement.
    if (s.rot) { const m = shapeMatrix(s); ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]); }
    ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([t.sx, 0, 0, t.sy, t.tx, t.ty])));
    p = new Path2D(s.d);
    sw = s.strokeWidth / Math.max(1e-6, Math.sqrt(Math.abs(t.sx * t.sy)));
  } else {
    // A turned or skewed rectangle or ellipse: drawn in its own coordinates (shapeTransform.ts).
    if (s.rot) { const m = shapeMatrix(s); ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]); }
    ctx.beginPath();
    if (s.type === 'rect') {
      const r = cornerRadii(s), b = rectBox(s);
      // A shape from before Rx/Ry keeps the native round rect it was always drawn with, pixel for pixel.
      const dashed = !!s.dash?.length && !!s.stroke && s.strokeWidth > 0;
      if (s.rx == null && s.ry == null && !dashed) ctx.roundRect(b.x, b.y, b.w, b.h, r.rx);
      else traceRoundRect(ctx, b, r.rx, r.ry, dashed);
    } else if (s.type === 'ellipse') ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2);
    else { ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.w, s.y + s.h); }
  }
  const fill = () => { if (s.fill && s.type !== 'line') { ctx.fillStyle = s.fill; if (p) ctx.fill(p); else ctx.fill(); } };
  const stroke = () => { if (s.stroke && s.strokeWidth > 0) { ctx.strokeStyle = s.stroke; applyStrokeLook(ctx, s, sw); if (p) ctx.stroke(p); else ctx.stroke(); } };
  if (s.paintOrder === 'stroke') { stroke(); fill(); } else { fill(); stroke(); }
}

/**
 * A blurred shape, as SVG and Inkscape do it: one blur over the painted shape. With fill and stroke both
 * painted they are composed first off-screen (blurring each apart mixes their colours differently); with one
 * of them alone that is the same image, so it is blurred straight on the target, without the off-screen pass.
 */
let blurScratch: HTMLCanvasElement | undefined;
function drawBlurredShape(ctx: CanvasRenderingContext2D, s: VectorShape): void {
  const m = ctx.getTransform(), k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)), sigma = s.blur! * k;
  const both = !!s.fill && s.type !== 'line' && !!s.stroke && s.strokeWidth > 0;
  if (!both) { ctx.save(); ctx.filter = `blur(${sigma}px)`; paintShape(ctx, s); ctx.restore(); return; }
  // The off-screen piece covers only what can reach the target: the shape's paint plus its blur margin,
  // cut to the canvas grown by that margin.
  const r = blurRegion(s), pad = BLUR_MARGIN * sigma + 2;
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const x0 = Math.floor(Math.max(-pad, Math.min(...pts.map((q) => q[0])))), y0 = Math.floor(Math.max(-pad, Math.min(...pts.map((q) => q[1]))));
  const x1 = Math.ceil(Math.min(ctx.canvas.width + pad, Math.max(...pts.map((q) => q[0])))), y1 = Math.ceil(Math.min(ctx.canvas.height + pad, Math.max(...pts.map((q) => q[1]))));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  // One scratch canvas for every blurred shape: it only grows (a resize reallocates), and only the part used is
  // cleared and drawn.
  const off = (blurScratch ??= createCanvas(1, 1)), o = ctx2d(off);
  if (off.width < w || off.height < h) { off.width = Math.max(off.width, w); off.height = Math.max(off.height, h); }
  else { o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, w, h); }
  o.save();
  o.beginPath(); o.rect(0, 0, w, h); o.clip();
  o.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
  paintShape(o, s);
  o.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = `blur(${sigma}px)`;
  ctx.drawImage(off, 0, 0, w, h, x0, y0, w, h);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, l: TextLayer): void {
  const t = layoutText(l);
  ctx.font = fontFor(l);
  applyLetterSpacing(ctx, l.letterSpacing);
  ctx.fillStyle = l.color;
  ctx.textBaseline = 'top';
  ctx.textAlign = l.align;
  const ax = l.align === 'center' ? l.x + t.width / 2 : l.align === 'right' ? l.x + t.width : l.x;
  // Center glyphs vertically inside each line box.
  const pad = (t.lineHeightPx - l.fontSize) / 2;
  t.lines.forEach((line, i) => ctx.fillText(line, ax, l.y + i * t.lineHeightPx + pad));
  applyLetterSpacing(ctx, 0);
}

/** `plain`: at full opacity and normal blend, for FX that filter the layer before it is composited. */
export function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, plain = false): void {
  // FX layers have no pixels of their own: drawDoc applies them (fx/plan.ts).
  if (!l.visible || l.opacity <= 0 || l.type === 'fx') return;
  ctx.save();
  ctx.globalAlpha = plain ? 1 : l.opacity;
  ctx.globalCompositeOperation = plain ? 'source-over' : GCO[l.blend] ?? 'source-over';
  if (l.transform && l.type !== 'vector') ctx.transform(...l.transform);
  if (l.type === 'raster') {
    const buf = getBuffer(l.id);
    if (buf) {
      // Close up (each pixel 4 screen px or more), pixels show as squares, as in Photoshop, Krita or SAI.
      const m = ctx.getTransform(), px = Math.hypot(m.a, m.b) * (l.width / Math.max(1, buf.width));
      ctx.imageSmoothingEnabled = px < PIXEL_VIEW_FROM;
      ctx.imageSmoothingQuality = 'high';
      const end = span('raster', 'draw', { pixels: buf.width * buf.height });
      ctx.drawImage(buf, l.x, l.y, l.width, l.height);
      end();
    }
  } else if (l.type === 'vector') {
    const paint = (c: CanvasRenderingContext2D) => { l.shapes.forEach(s => drawShape(c, s)); l.strokes?.forEach(s => drawStroke(c, s)); };
    // Opacity and blend belong to the layer as a whole, as SVG groups them (W3C Compositing): with more than one
    // paint operation (two shapes, or one with fill and stroke) they are composed first and blended once. One
    // operation, full opacity and Normal stay direct. A pixel mask already composes the layer.
    if (l.pixelMask) drawMaskedVector(ctx, l, paint);
    else if (!plain && (l.opacity < 1 || l.blend !== 'normal') && paintOps(l) > 1) drawGrouped(ctx, l, paint);
    else paint(ctx);
  } else {
    drawText(ctx, l);
  }
  ctx.restore();
}

/** Paint operations of a vector layer that would overlap: fill and stroke count apart; a blurred shape is one
    (it is composed before its blur); a Lineart stroke counts as several (its tip stamps overlap). */
function paintOps(l: VectorLayer): number {
  let n = 0;
  for (const s of l.shapes) n += s.blur ? 1 : (s.fill && s.type !== 'line' ? 1 : 0) + (s.stroke && s.strokeWidth > 0 ? 1 : 0);
  return n + (l.strokes?.length ?? 0) * 2;
}

/** A vector layer composed apart and laid on the target once, with the target's opacity and blend. The piece covers
    only what the layer paints (with its strokes and blur margins), cut to the target; its canvas is reused. */
let groupScratch: HTMLCanvasElement | undefined;
function drawGrouped(ctx: CanvasRenderingContext2D, l: VectorLayer, paint: (c: CanvasRenderingContext2D) => void): void {
  const r = unionBox([...l.shapes.map(blurRegion), ...(l.strokes ?? []).map(strokeBox).filter((b): b is Box => b != null)]);
  if (!r) return;
  const m = ctx.getTransform(), pad = 2;
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const x0 = Math.floor(Math.max(0, Math.min(...pts.map((q) => q[0])) - pad)), y0 = Math.floor(Math.max(0, Math.min(...pts.map((q) => q[1])) - pad));
  const x1 = Math.ceil(Math.min(ctx.canvas.width, Math.max(...pts.map((q) => q[0])) + pad)), y1 = Math.ceil(Math.min(ctx.canvas.height, Math.max(...pts.map((q) => q[1])) + pad));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const off = (groupScratch ??= createCanvas(1, 1)), o = ctx2d(off);
  if (off.width < w || off.height < h) { off.width = Math.max(off.width, w); off.height = Math.max(off.height, h); }
  else { o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, w, h); }
  o.save();
  o.beginPath(); o.rect(0, 0, w, h); o.clip();
  o.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
  paint(o);
  o.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(off, 0, 0, w, h, x0, y0, w, h);
  ctx.restore();
}

/** Draw the document in doc coordinates (caller sets the transform). */
export function drawDoc(ctx: CanvasRenderingContext2D, doc: DesignDoc, opts: { hideLayerId?: string; origin?: RenderOrigin; resolution?: 'preview' | 'document' } = {}): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, doc.width, doc.height);
  ctx.clip();
  const steps = fxPlan(doc.layers, opts.hideLayerId);
  // Editor latency is independent of the domains selected for recording.
  const stage = traceStatus() !== null && (ctx.canvas as HTMLCanvasElement | undefined)?.classList?.contains('stage-canvas');
  const { context, end } = beginRender(opts.origin ?? (stage ? 'editor' : 'offscreen'), { layers: doc.layers.length, fx: steps.reduce((k, s) => k + (s.t === 'clip' ? s.fx.length : s.t === 'below' ? 1 : 0), 0), page: `${doc.width}x${doc.height}` });
  if (stage) takeCanvasCount();
  // Stage without FX: retained page at whole-pixel views (Paso 6).
  const m = ctx.getTransform();
  if (steps.every((s) => s.t === 'draw') && !(stage && Number.isInteger(m.e) && Number.isInteger(m.f))) {
    if (doc.background) {
      ctx.fillStyle = doc.background;
      ctx.fillRect(0, 0, doc.width, doc.height);
    }
    for (const s of steps) drawLayer(ctx, s.layer);
  } else drawWithFx(ctx, doc, steps, opts.resolution === 'document', context, !!(ctx.canvas as HTMLCanvasElement | undefined)?.classList?.contains('stage-canvas'));
  ctx.restore();
  end?.(stage ? takeCanvasCount() : undefined);
  if (stage) frameShown();
}

/*
 * The editor's FX cache: a layer's filtered pixels are kept while nothing they come from changes (the layer object,
 * its pixels' content version, its FX layers and the view scale), so moving, zooming the page around it or painting
 * another layer does not run the filters again every frame. Editor frames only (exports always compute), at most
 * FX_CACHE_PX pixels in all; the oldest entry goes first.
 */
import { editorCacheBudget } from './cacheBudget';
const fxCache = new Map<string, { key: unknown[]; canvas: HTMLCanvasElement; at: number }>();
let fontEpoch = 0;
if (typeof document !== 'undefined') document.fonts?.addEventListener?.('loadingdone', () => { fontEpoch++; });
function contentKey(l: Layer, s: { fx: FxLayer[] }, geom: unknown[]): unknown[] {
  // The pixels' versions go last: while a stroke is painted only they change (see cachedFx).
  return [l, ...s.fx, ...geom, fontEpoch, ...rasterBufferIds([l]).map(bufferVersion)];
}
/*
 * Mid-stroke on the filtered layer itself, the result may be up to FX_LIVE_MS old instead of filtering on every
 * move (as Krita and GIMP let filters trail the brush); the stroke's commit brings it up to date.
 */
const FX_LIVE_MS = 120;
/** Set when a frame used a trailing (not yet caught up) FX result: the retained page is then not kept. */
let servedStale = false;
function cachedFx(id: string, key: unknown[], versions: number): HTMLCanvasElement | undefined {
  const hit = fxCache.get(id);
  if (!hit || hit.key.length !== key.length) return undefined;
  const same = (n: number) => key.slice(0, n).every((k, i) => k === hit.key[i]);
  const fresh = same(key.length), trailing = !fresh && paintingLive() && same(key.length - versions) && performance.now() - hit.at < FX_LIVE_MS;
  if (!fresh && !trailing) return undefined;
  editorCacheBudget.touch(`fx:${id}`);
  // A held, unmoving pointer sends no new frame: one is asked for when the trailing result runs out.
  if (trailing) { redrawSoon(FX_LIVE_MS - (performance.now() - hit.at)); servedStale = true; }
  fxCache.delete(id);
  fxCache.set(id, hit);
  return hit.canvas;
}
function keepFx(id: string, key: unknown[], canvas: HTMLCanvasElement): void {
  fxCache.delete(id);
  fxCache.set(id, { key, canvas, at: performance.now() });
  // One byte budget shared with the 'below' results and the stroke masks (Paso 4): the oldest entries go first.
  editorCacheBudget.put(`fx:${id}`, canvas.width * canvas.height * 4, () => fxCache.delete(id));
}

/** Most canvas pixels an FX composite uses (the view's resolution, capped). */
const FX_MAX_PX = 16_000_000;

/*
 * With FX the page is composed off screen at the view's scale, so 'below' FX see everything under them.
 * Delivery uses scale 1 with the same plan. FX lengths are document px.
 */
const retained = new RetainedPage<HTMLCanvasElement>();
const fullRect = (W: number, H: number): Rect => ({ x0: 0, y0: 0, x1: W, y1: H });
const versionsOf = (l: Layer): unknown[] => rasterBufferIds([l]).map(bufferVersion);
function retainedLayerBox(l: Layer, dirty: Rect | null | undefined): Box | null {
  if (l.type !== 'raster' || l.sourceAssetId) return layerBox(l);
  const box = rasterPaintedBox(l, !dirty, true);
  if (box === undefined) return dirty ? (l.transform ? mapBox(l.transform, { x: l.x, y: l.y, w: l.width, h: l.height }) : { x: l.x, y: l.y, w: l.width, h: l.height }) : layerBox(l);
  return box && l.transform ? mapBox(l.transform, box) : box;
}
function retainedLayerPlacement(l: Layer): Box | null {
  if (l.type !== 'raster' || l.sourceAssetId) return layerBox(l);
  const box = { x: l.x, y: l.y, w: l.width, h: l.height };
  return l.transform ? mapBox(l.transform, box) : box;
}

/** The plan's steps composed into a canvas of `crop` (canvas px of the W×H page at `scale`; the page itself when it is the whole page). */
function composeFx(doc: DesignDoc, steps: ReturnType<typeof fxPlan>, scale: number, W: number, H: number, crop: Rect, editor: boolean, trace?: RenderTrace): HTMLCanvasElement {
  const ox = crop.x0, oy = crop.y0, cw = crop.x1 - ox, ch = crop.y1 - oy;
  let acc = createCanvas(cw, ch);
  const at = (c: HTMLCanvasElement) => { const x = ctx2d(c); x.setTransform(scale, 0, 0, scale, -ox, -oy); return x; };
  if (doc.background) {
    const x = at(acc);
    x.fillStyle = doc.background;
    x.fillRect(0, 0, doc.width, doc.height);
  }
  // Editor frames: 'below' cache keys (page, crop, background, fonts, pixels).
  const below: unknown[] = editor ? [scale, W, H, ox, oy, cw, ch, doc.background, fontEpoch] : [];
  for (const s of steps) {
    const end = s.t === 'draw' ? null : span('fx', 'layer', { ...trace, scope: s.t === 'below' ? 'below' : 'layer', fx: s.t === 'below' ? 1 : s.fx.length, size: `${cw}x${ch}` });
    if (s.t === 'draw') { drawLayer(at(acc), s.layer); if (editor) below.push(s.layer, ...versionsOf(s.layer)); }
    else if (s.t === 'below') {
      const key = editor ? [...below, s.fx] : null, hit = key && cachedBelow(s.fx.id, key);
      if (hit) { acc = createCanvas(cw, ch); ctx2d(acc).drawImage(hit, 0, 0); }
      else { acc = mixFx(acc, s.fx, { scale, clip: false, trace }); if (key) keepBelow(s.fx.id, key, cloneCanvas(acc)); }
      if (editor) below.push(s.fx);
    }
    else {
      // A layer's FX run on its own box, on whole pixels: the result does not depend on the crop.
      const box = layerBox(s.layer);
      const ix = box ? Math.floor(box.x * scale) : 0, iy = box ? Math.floor(box.y * scale) : 0;
      const iw = box ? Math.max(1, Math.ceil((box.x + box.w) * scale) - ix) : 1, ih = box ? Math.max(1, Math.ceil((box.y + box.h) * scale) - iy) : 1;
      const inCrop = !!box && ix < ox + cw && iy < oy + ch && ix + iw > ox && iy + ih > oy;
      const key = editor && inCrop ? contentKey(s.layer, s, [scale, ix, iy, iw, ih]) : null;
      let own = key && cachedFx(s.layer.id, key, versionsOf(s.layer).length);
      if (box && inCrop && !own) {
        own = createCanvas(iw, ih);
        const x = ctx2d(own);
        x.setTransform(scale, 0, 0, scale, -ix, -iy);
        drawLayer(x, s.layer, true);
        const region = { x: box.x * scale - ix, y: box.y * scale - iy, w: box.w * scale, h: box.h * scale };
        for (const fx of s.fx) own = mixFx(own, fx, { scale, clip: true, region, trace });
        if (key) keepFx(s.layer.id, key, own);
      }
      if (editor) below.push(s.layer, ...s.fx, ...versionsOf(s.layer));
      if (own) {
        const x = ctx2d(acc);
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.globalAlpha = s.layer.opacity;
        x.globalCompositeOperation = GCO[s.layer.blend] ?? 'source-over';
        x.drawImage(own, ix - ox, iy - oy);
        x.globalAlpha = 1;
        x.globalCompositeOperation = 'source-over';
      }
    }
    end?.();
  }
  return acc;
}

/** Editor frame through the retained page (only changed areas are composed again). */
function retainedFrame(doc: DesignDoc, steps: ReturnType<typeof fxPlan>, scale: number, W: number, H: number, trace?: RenderTrace): HTMLCanvasElement {
  const dirtyByLayer = new Map<Layer, Rect | null>();
  const dirtyOf = (layer: Layer) => {
    if (!dirtyByLayer.has(layer)) dirtyByLayer.set(layer, rasterDirtyRect(layer, scale));
    return dirtyByLayer.get(layer) ?? null;
  };
  const cur: FrameMemo = {
    W, H, scale, background: doc.background, fontEpoch,
    base: doc.background ? fullRect(W, H) : null,
    steps: retainedPlannerSteps(
      doc.layers, steps, scale,
      (l) => paintArea(l, scale, (target) => retainedLayerBox(target, dirtyByLayer.get(target))),
      versionsOf, dirtyOf,
      (l) => paintArea(l, scale, retainedLayerPlacement),
    ),
  };
  servedStale = false;
  const page = retained.frame(cur, {
    compose: (crop) => composeFx(doc, steps, scale, W, H, crop ?? fullRect(W, H), true, trace),
    blit: (dst, src, from, to) => {
      const w = to.x1 - to.x0, h = to.y1 - to.y0, x = ctx2d(dst);
      // 'copy' clears all outside the drawn part: clear the region, then copy.
      x.save();
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(to.x0, to.y0, w, h);
      x.drawImage(src, from.x0, from.y0, w, h, to.x0, to.y0, w, h);
      x.restore();
    },
  });
  // A stale result must not stay as the page: the next frame composes again.
  if (servedStale) retained.reset();
  return page;
}

function drawWithFx(ctx: CanvasRenderingContext2D, doc: DesignDoc, steps: ReturnType<typeof fxPlan>, fullResolution: boolean, trace?: RenderTrace, editor = false): void {
  const m = ctx.getTransform();
  const scale = fullResolution ? 1 : Math.min(Math.max(0.05, Math.hypot(m.a, m.b) || 1), Math.sqrt(FX_MAX_PX / Math.max(1, doc.width * doc.height)));
  const W = Math.max(1, Math.floor(doc.width * scale)), H = Math.max(1, Math.floor(doc.height * scale));
  const page = editor && !fullResolution ? retainedFrame(doc, steps, scale, W, H, trace) : composeFx(doc, steps, scale, W, H, fullRect(W, H), editor, trace);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(page, 0, 0, doc.width, doc.height);
}

/** Bench (parity): the page at `scale` through the retained path, or the whole composition with no caches. */
export function composeFrame(doc: DesignDoc, scale: number, retainedPath: boolean): HTMLCanvasElement {
  const steps = fxPlan(doc.layers);
  const W = Math.max(1, Math.floor(doc.width * scale)), H = Math.max(1, Math.floor(doc.height * scale));
  return retainedPath ? retainedFrame(doc, steps, scale, W, H) : composeFx(doc, steps, scale, W, H, fullRect(W, H), false);
}
export const resetRetainedPage = (): void => retained.reset();
export const retainedStats = () => ({ ...retained.stats, fullWhy: { ...retained.stats.fullWhy }, lastPlan: retained.lastPlan });

export async function exportDoc(doc: DesignDoc, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<Blob> {
  checkExportSize(doc.width, doc.height, fxPlan(doc.layers).some((step) => step.t !== 'draw'));
  try {
    const c = createCanvas(doc.width, doc.height);
    const ctx = ctx2d(c);
    if (type === 'image/jpeg' && !doc.background) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, doc.width, doc.height);
    }
    drawDoc(ctx, doc, { origin: 'export', resolution: 'document' });
    if (ctx.isContextLost?.()) throw new Error('The browser lost the canvas context.');
    return await canvasToBlob(c, type, type === 'image/jpeg' ? 0.92 : undefined);
  } catch (error) {
    throw new Error(`Export failed at full resolution (${doc.width} × ${doc.height}). No file was created. Try a smaller document or fewer FX layers. ${error instanceof Error ? error.message : ''}`);
  }
}

/** Render a single raster layer's pixels (as displayed) into a standalone image, for ops. */
export async function rasterLayerBlob(l: Layer): Promise<Blob | null> {
  if (l.type !== 'raster') return null;
  const buf = getBuffer(l.id);
  if (!buf) return null;
  return canvasToBlob(buf, 'image/png');
}

/** Topmost visible layer whose box contains the point. */
/**
 * The topmost visible layer with something drawn exactly at (x, y): raster layers by their pixels (alpha), others
 * by their box. Big transparent layers (a paint layer the size of the page) no longer catch every click.
 */
export function hitTestPixel(doc: DesignDoc, x: number, y: number): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!l.visible) continue;
    const b = layerBox(l);
    if (!b || x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
    if (l.type === 'vector') {
      if (!maskContains(l, x, y)) continue;
      // One of its own shapes or strokes, not the box around all of them.
      const inside = (bx: Box | null) => bx && x >= bx.x && x <= bx.x + bx.w && y >= bx.y && y <= bx.y + bx.h;
      if (l.shapes.some((sh) => inside(shapeBox(sh))) || (l.strokes ?? []).some((st) => inside(strokeBox(st)))) return l;
      continue;
    }
    if (l.type !== 'raster') return l;
    const buf = getBuffer(l.id);
    if (!buf) continue;
    const [lx, ly] = toLayerSpace(l, x, y);
    const px = Math.floor(((lx - l.x) / l.width) * buf.width), py = Math.floor(((ly - l.y) / l.height) * buf.height);
    if (px < 0 || py < 0 || px >= buf.width || py >= buf.height) continue;
    // A small neighbourhood, so thin strokes can be picked.
    const r = Math.max(1, Math.round(buf.width / Math.max(1, l.width) * 3));
    const x0 = Math.max(0, px - r), y0 = Math.max(0, py - r);
    const alpha = bufferAlpha(l.id, buf), x1 = Math.min(buf.width, x0 + r * 2 + 1), y1 = Math.min(buf.height, y0 + r * 2 + 1);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) if (alpha[yy * buf.width + xx] > 16) return l;
  }
  return null;
}

export function hitTest(doc: DesignDoc, x: number, y: number): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!l.visible) continue;
    const b = layerBox(l);
    if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return l;
  }
  return null;
}
