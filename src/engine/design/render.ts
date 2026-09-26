import { canvasToBlob, createCanvas, ctx2d } from '../../lib/media';
import type { BlendMode, DesignDoc, Layer, TextLayer, VectorShape } from '../types';
import { fontStack, shapeBox, unionBox, type Box } from './doc';
import { getBuffer } from './raster';
import { drawStroke } from './brushTextures';
import { strokeBox } from './strokes';

/* One renderer for both the editor view and exports, so what you see is what you export. */

const GCO: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'soft-light': 'soft-light',
  'hard-light': 'hard-light',
  difference: 'difference',
  color: 'color',
  luminosity: 'luminosity',
};

export const BLEND_MODES = Object.keys(GCO) as BlendMode[];

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

export function layerBox(l: Layer): Box | null {
  switch (l.type) {
    case 'raster':
      return { x: l.x, y: l.y, w: l.width, h: l.height };
    case 'vector':
      return unionBox([...l.shapes.map(shapeBox), ...(l.strokes ?? []).map(strokeBox).filter((b): b is Box => b != null)]);
    case 'text': {
      const t = layoutText(l);
      return { x: l.x, y: l.y, w: t.width, h: t.height };
    }
  }
}

function drawShape(ctx: CanvasRenderingContext2D, s: VectorShape): void {
  ctx.beginPath();
  if (s.type === 'rect') {
    const x = Math.min(s.x, s.x + s.w);
    const y = Math.min(s.y, s.y + s.h);
    const w = Math.abs(s.w);
    const h = Math.abs(s.h);
    ctx.roundRect(x, y, w, h, Math.min(s.radius, w / 2, h / 2));
  } else if (s.type === 'ellipse') {
    ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + s.w, s.y + s.h);
  }
  if (s.fill && s.type !== 'line') {
    ctx.fillStyle = s.fill;
    ctx.fill();
  }
  if (s.stroke && s.strokeWidth > 0) {
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = s.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
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

export function drawLayer(ctx: CanvasRenderingContext2D, l: Layer): void {
  if (!l.visible || l.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = l.opacity;
  ctx.globalCompositeOperation = GCO[l.blend] ?? 'source-over';
  if (l.type === 'raster') {
    const buf = getBuffer(l.id);
    if (buf) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(buf, l.x, l.y, l.width, l.height);
    }
  } else if (l.type === 'vector') {
    l.shapes.forEach((s) => drawShape(ctx, s));
    l.strokes?.forEach((s) => drawStroke(ctx, s));
  } else {
    drawText(ctx, l);
  }
  ctx.restore();
}

/** Draw the document in doc coordinates (caller sets the transform). */
export function drawDoc(ctx: CanvasRenderingContext2D, doc: DesignDoc, opts: { hideLayerId?: string } = {}): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, doc.width, doc.height);
  ctx.clip();
  if (doc.background) {
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  for (const l of doc.layers) {
    if (l.id === opts.hideLayerId) continue;
    drawLayer(ctx, l);
  }
  ctx.restore();
}

export async function exportDoc(doc: DesignDoc, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<Blob> {
  const c = createCanvas(doc.width, doc.height);
  const ctx = ctx2d(c);
  if (type === 'image/jpeg' && !doc.background) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  drawDoc(ctx, doc);
  return canvasToBlob(c, type, type === 'image/jpeg' ? 0.92 : undefined);
}

/** Render a single raster layer's pixels (as displayed) into a standalone image, for ops. */
export async function rasterLayerBlob(l: Layer): Promise<Blob | null> {
  if (l.type !== 'raster') return null;
  const buf = getBuffer(l.id);
  if (!buf) return null;
  return canvasToBlob(buf, 'image/png');
}

/** Topmost visible layer whose box contains the point. */
export function hitTest(doc: DesignDoc, x: number, y: number): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!l.visible) continue;
    const b = layerBox(l);
    if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return l;
  }
  return null;
}
