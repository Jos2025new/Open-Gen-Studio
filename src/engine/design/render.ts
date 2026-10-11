import { checkExportSize } from './exportLimits';
import { drawMaskedVector, maskContains, maskBounds } from './vectorMask';
import { apply, invert, mapBox } from './matrix';
import { pathTransform } from './path';
import { canvasToBlob, createCanvas, ctx2d } from '../../lib/media';
import type { BlendMode, DesignDoc, Layer, TextLayer, VectorShape } from '../types';
import { fontStack, shapeBox, unionBox, type Box } from './doc';
import { shapeMatrix } from './shapeTransform';
import { applyStrokeLook, BLUR_MARGIN, blurRegion, cornerRadii, rectBox, traceRoundRect } from './shapeLook';
import { bufferVersion, getBuffer, paintingLive, rasterBufferIds, rasterVersion, redrawSoon } from './raster';
import type { FxLayer } from '../fx/types';
import { drawStroke } from './brushTextures';
import { strokeBox } from './strokes';
import { fxPlan } from '../fx/plan';
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

let measureCtx: CanvasRenderingContext2D | null = null;

function measurer(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = ctx2d(createCanvas(8, 8));
  return measureCtx;
}

function fontFor(l: Pick<TextLayer, 'fontWeight' | 'fontSize' | 'fontFamily'>): string {
  return `${l.fontWeight} ${l.fontSize}px ${fontStack(l.fontFamily)}`;
}

function applyLetterSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
}

export interface TextLayout {
  lines: string[];
  width: number;
  height: number;
  lineHeightPx: number;
}

/** Word-wrap a text layer to its box width. */
export function layoutText(l: TextLayer): TextLayout {
  const ctx = measurer();
  ctx.font = fontFor(l);
  applyLetterSpacing(ctx, l.letterSpacing);
  const maxW = l.width > 0 ? l.width : Infinity;
  const lines: string[] = [];
  for (const para of l.text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (line && ctx.measureText(test.trimEnd()).width > maxW && w.trim()) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else {
        line = test;
      }
    }
    lines.push(line.trimEnd());
  }
  const lineHeightPx = l.fontSize * l.lineHeight;
  const width = l.width > 0 ? l.width : Math.max(1, ...lines.map((s) => ctx.measureText(s).width));
  return { lines, width, height: Math.max(lineHeightPx, lines.length * lineHeightPx), lineHeightPx };
}

/** Top of the em box to the alphabetic baseline: where SVG places the baseline for the canvas 'top' layout. */
export function textAscent(l: TextLayer): number {
  const ctx = measurer();
  ctx.font = fontFor(l);
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText('Mg') as TextMetrics & { emHeightAscent?: number };
  return m.emHeightAscent ?? m.fontBoundingBoxAscent ?? l.fontSize * 0.8;
}

/** A painted layer (no image) is page-sized: select and move what is drawn, not the whole page. Cached per buffer version. */
const painted = new WeakMap<HTMLCanvasElement, { version: number; at: number; box: { x0: number; y0: number; x1: number; y1: number } | null }>();
function paintedBox(l: Extract<Layer, { type: 'raster' }>): Box | null {
  if (l.sourceAssetId) return null;
  const buf = getBuffer(l.id);
  if (!buf || !buf.width || !buf.height) return null;
  let hit = painted.get(buf);
  // While painting the version changes every segment: rescan at most every 150 ms.
  if (!hit || (hit.version !== rasterVersion() && performance.now() - hit.at > 150)) {
    const data = buf.getContext('2d')!.getImageData(0, 0, buf.width, buf.height).data;
    let x0 = buf.width, y0 = buf.height, x1 = -1, y1 = -1;
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        if (data[(y * buf.width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    hit = { version: rasterVersion(), at: performance.now(), box: x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 } };
    painted.set(buf, hit);
  }
  if (!hit.box) return null;
  const kx = l.width / buf.width, ky = l.height / buf.height;
  return { x: l.x + hit.box.x0 * kx, y: l.y + hit.box.y0 * ky, w: (hit.box.x1 - hit.box.x0) * kx, h: (hit.box.y1 - hit.box.y0) * ky };
}

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
      return paintedBox(l) ?? { x: l.x, y: l.y, w: l.width, h: l.height };
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
      ctx.drawImage(buf, l.x, l.y, l.width, l.height);
    }
  } else if (l.type === 'vector') {
    const paint = (c: CanvasRenderingContext2D) => { l.shapes.forEach(s => drawShape(c, s)); l.strokes?.forEach(s => drawStroke(c, s)); };
    if (l.pixelMask) drawMaskedVector(ctx, l, paint); else paint(ctx);
  } else {
    drawText(ctx, l);
  }
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
  if (steps.every((s) => s.t === 'draw')) {
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
const FX_CACHE_PX = 48_000_000;
const fxCache = new Map<string, { key: unknown[]; canvas: HTMLCanvasElement; at: number }>();
let fontEpoch = 0;
if (typeof document !== 'undefined') document.fonts?.addEventListener?.('loadingdone', () => { fontEpoch++; });
function contentKey(l: Layer, s: { fx: FxLayer[] }, scale: number, W: number, H: number): unknown[] {
  // The pixels' versions go last: while a stroke is painted only they change (see cachedFx).
  return [l, ...s.fx, scale, W, H, fontEpoch, ...rasterBufferIds([l]).map(bufferVersion)];
}
/*
 * Mid-stroke on the filtered layer itself, the result may be up to FX_LIVE_MS old instead of filtering on every
 * move (as Krita and GIMP let filters trail the brush); the stroke's commit brings it up to date.
 */
const FX_LIVE_MS = 120;
function cachedFx(id: string, key: unknown[], versions: number): HTMLCanvasElement | undefined {
  const hit = fxCache.get(id);
  if (!hit || hit.key.length !== key.length) return undefined;
  const same = (n: number) => key.slice(0, n).every((k, i) => k === hit.key[i]);
  const fresh = same(key.length), trailing = !fresh && paintingLive() && same(key.length - versions) && performance.now() - hit.at < FX_LIVE_MS;
  if (!fresh && !trailing) return undefined;
  // A held, unmoving pointer sends no new frame: one is asked for when the trailing result runs out.
  if (trailing) redrawSoon(FX_LIVE_MS - (performance.now() - hit.at));
  fxCache.delete(id);
  fxCache.set(id, hit);
  return hit.canvas;
}
function keepFx(id: string, key: unknown[], canvas: HTMLCanvasElement): void {
  fxCache.delete(id);
  fxCache.set(id, { key, canvas, at: performance.now() });
  let px = 0;
  for (const e of fxCache.values()) px += e.canvas.width * e.canvas.height;
  for (const [k, e] of fxCache) {
    if (px <= FX_CACHE_PX || fxCache.size <= 1) break;
    px -= e.canvas.width * e.canvas.height;
    fxCache.delete(k);
  }
}

/** Most canvas pixels an FX composite uses (the view's resolution, capped). */
const FX_MAX_PX = 16_000_000;

/**
 * With FX the page is composed off screen, at the resolution it is shown (the view transform's scale), so 'below'
 * FX see everything under them, background included. Delivery uses scale 1 with this same plan. Lengths in FX params are document px.
 */
function drawWithFx(ctx: CanvasRenderingContext2D, doc: DesignDoc, steps: ReturnType<typeof fxPlan>, fullResolution: boolean, trace?: RenderTrace, editor = false): void {
  const m = ctx.getTransform();
  const scale = fullResolution ? 1 : Math.min(Math.max(0.05, Math.hypot(m.a, m.b) || 1), Math.sqrt(FX_MAX_PX / Math.max(1, doc.width * doc.height)));
  const W = Math.max(1, Math.floor(doc.width * scale)), H = Math.max(1, Math.floor(doc.height * scale));
  let acc = createCanvas(W, H);
  const at = (c: HTMLCanvasElement) => { const x = ctx2d(c); x.setTransform(scale, 0, 0, scale, 0, 0); return x; };
  if (doc.background) {
    const x = at(acc);
    x.fillStyle = doc.background;
    x.fillRect(0, 0, doc.width, doc.height);
  }
  for (const s of steps) {
    const end = s.t === 'draw' ? null : span('fx', 'layer', { ...trace, scope: s.t === 'below' ? 'below' : 'layer', fx: s.t === 'below' ? 1 : s.fx.length, size: `${W}x${H}` });
    if (s.t === 'draw') drawLayer(at(acc), s.layer);
    else if (s.t === 'below') acc = mixFx(acc, s.fx, { scale, clip: false, trace });
    else {
      const key = editor ? contentKey(s.layer, s, scale, W, H) : null;
      let own = key && cachedFx(s.layer.id, key, rasterBufferIds([s.layer]).length);
      if (!own) {
        own = createCanvas(W, H);
        drawLayer(at(own), s.layer, true);
        const box = layerBox(s.layer);
        const region = box ? { x: box.x * scale, y: box.y * scale, w: box.w * scale, h: box.h * scale } : undefined;
        for (const fx of s.fx) own = mixFx(own, fx, { scale, clip: true, region, trace });
        if (key) keepFx(s.layer.id, key, own);
      }
      // In canvas px: `own` is already at the composite's scale.
      const x = ctx2d(acc);
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalAlpha = s.layer.opacity;
      x.globalCompositeOperation = GCO[s.layer.blend] ?? 'source-over';
      x.drawImage(own, 0, 0);
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'source-over';
    }
    end?.();
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(acc, 0, 0, doc.width, doc.height);
}

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
    const data = buf.getContext('2d')?.getImageData(x0, y0, Math.min(buf.width - x0, r * 2 + 1), Math.min(buf.height - y0, r * 2 + 1)).data;
    if (data) for (let k = 3; k < data.length; k += 4) if (data[k] > 16) return l;
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
