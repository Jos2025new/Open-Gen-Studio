import type { DesignDoc } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { setDoc } from '../../store/store';
import { insertLayer, newRasterLayer } from './doc';
import { record } from './history';
import { getSelection, selectionPath, type PixelSelection } from './pixelSelection';
import { setBuffer } from './raster';

/* Gradient tool, as in Paint Tool SAI 2: drag a line; linear or radial; main color to second color or to transparent.
   It lands on a new layer above the active one (the artwork below is untouched), clipped to the pixel selection. */

export interface GradientSpec {
  shape: 'linear' | 'radial';
  /** 'two': main color → second color; 'fade': main color → transparent. */
  mode: 'two' | 'fade';
  color: string;
  color2: string;
  reverse?: boolean;
  opacity: number;
}

const withAlpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Paint the gradient from (x0, y0) to (x1, y1) over the page on `ctx` (page coordinates), clipped to `sel`. */
export function paintGradient(ctx: CanvasRenderingContext2D, doc: Pick<DesignDoc, 'width' | 'height'>, spec: GradientSpec, x0: number, y0: number, x1: number, y1: number, sel?: PixelSelection | null): void {
  const g = spec.shape === 'radial'
    ? ctx.createRadialGradient(x0, y0, 0, x0, y0, Math.max(1, Math.hypot(x1 - x0, y1 - y0)))
    : ctx.createLinearGradient(x0, y0, x1, y1);
  let a = spec.color, b = spec.mode === 'fade' ? withAlpha(spec.color, 0) : spec.color2;
  if (spec.reverse) [a, b] = [b, a];
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.save();
  ctx.globalAlpha *= spec.opacity;
  if (sel) {
    selectionPath(ctx, doc, sel);
    ctx.clip('evenodd');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, doc.width, doc.height);
  ctx.restore();
}

/** The gradient as a new page-sized layer above the active one. One undo step. */
export function applyGradient(sessionId: string, doc: DesignDoc, spec: GradientSpec, x0: number, y0: number, x1: number, y1: number): void {
  const w = Math.round(doc.width), h = Math.round(doc.height);
  const canvas = createCanvas(w, h);
  paintGradient(ctx2d(canvas), doc, { ...spec, opacity: 1 }, x0, y0, x1, y1, getSelection(doc.id));
  const layer = { ...newRasterLayer('Gradient', { x: 0, y: 0, width: doc.width, height: doc.height }, { width: w, height: h }), opacity: spec.opacity };
  record(doc);
  setBuffer(layer.id, canvas);
  setDoc(sessionId, doc.id, (d) => insertLayer(d, layer, 'above'));
}
