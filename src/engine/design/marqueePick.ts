import type { DesignDoc, Layer } from '../types';
import { layerBox, toLayerSpace } from './render';
import { getRasterSurface } from './raster';
import { bufferAlpha } from './hitAlpha';
import { layerObjects } from './objectOps';
import { marqueeBounds, type MarqueeBounds } from './marquee';

/*
 * What the Edit marquee finds under a rectangle. A vector layer counts by its objects (shapes, lines), a raster layer
 * by its painted pixels (a baked drawing has no objects), other layers by their box. Pure: no store, no selection.
 */

const touches = (b: MarqueeBounds, r: { x: number; y: number; w: number; h: number }) =>
  r.x <= b.right && r.x + r.w >= b.left && r.y <= b.bottom && r.y + r.h >= b.top;

/** True when some pixel of a raster layer with alpha lies inside the rectangle (page coordinates). */
export function rasterPaintedIn(l: Layer, b: MarqueeBounds): boolean {
  if (l.type !== 'raster') return false;
  const surface = getRasterSurface(l.id);
  if (!surface || surface.empty) return false;
  const [ax, ay] = toLayerSpace(l, b.left, b.top), [bx, by] = toLayerSpace(l, b.right, b.bottom);
  const sx = surface.fw / Math.max(1, l.width), sy = surface.fh / Math.max(1, l.height);
  const buf = surface.canvas;
  const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - l.x) * sx) - surface.x0), x1 = Math.min(buf.width - 1, Math.ceil((Math.max(ax, bx) - l.x) * sx) - surface.x0);
  const y0 = Math.max(0, Math.floor((Math.min(ay, by) - l.y) * sy) - surface.y0), y1 = Math.min(buf.height - 1, Math.ceil((Math.max(ay, by) - l.y) * sy) - surface.y0);
  if (x1 < x0 || y1 < y0) return false;
  const alpha = bufferAlpha(l.id, buf);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (alpha[y * buf.width + x] > 16) return true;
  return false;
}

export interface MarqueeFound {
  /** Objects of each layer the rectangle touches (vector shapes and lines, or strokes kept on a raster layer). */
  objects: Map<string, string[]>;
  /** Layers the rectangle touches at all: by an object, by painted pixels, or by their box. */
  layers: string[];
}

export function marqueeFind(doc: DesignDoc, x0: number, y0: number, x1: number, y1: number, painted: (l: Layer, b: MarqueeBounds) => boolean = rasterPaintedIn): MarqueeFound {
  const b = marqueeBounds(x0, y0, x1, y1);
  const objects = new Map<string, string[]>();
  const layers: string[] = [];
  for (const l of doc.layers) {
    if (!l.visible || l.locked || l.type === 'fx') continue;
    const hits = layerObjects(l).filter((o) => touches(b, o.box)).map((o) => o.id);
    if (hits.length) { objects.set(l.id, hits); layers.push(l.id); continue; }
    if (l.type === 'vector') continue;
    if (l.type === 'raster') { if (painted(l, b)) layers.push(l.id); continue; }
    const box = layerBox(l);
    if (box && touches(b, box)) layers.push(l.id);
  }
  return { objects, layers };
}
