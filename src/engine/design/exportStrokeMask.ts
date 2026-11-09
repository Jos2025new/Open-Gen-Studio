import type { DesignDoc, Layer, RasterLayer } from '../types';
import type { Box } from './doc';
import { createCanvas, ctx2d } from '../../lib/media';
import { drawRasterStroke } from './rasterDraw';
import { drawLayer } from './render';
import { getRasterSurface } from './raster';

/*
 * Exporting some strokes of a painted layer, faithfully: the layer's own pixels (blends, brush texture, erasing — what
 * the canvas shows) cut to the picked strokes' footprint. Nothing is repainted, so no brush can come out different.
 * The mask is page-shaped, as a pixel selection's: picked strokes by their footprint, every other kept layer by its
 * own coverage.
 */
/** Most pixels one mask may take (≈128 MB as RGBA): beyond it the mask gets coarser, the export still runs. */
export const STROKE_MASK_MAX_PIXELS = 33_554_432;

export function strokesExportMask(doc: DesignDoc, kept: Layer[], strokes: Map<string, Set<string>>, box: Box = { x: 0, y: 0, w: doc.width, h: doc.height }): HTMLCanvasElement {
  // Sharp at the painted layers' own resolution (at most 4× the page) so edges do not soften when upscaled.
  const want = Math.min(4, Math.max(1, ...kept.map((l) => {
    const s = l.type === 'raster' && strokes.has(l.id) ? getRasterSurface(l.id) : null;
    return s && l.type === 'raster' ? s.fw / l.width : 1;
  })));
  // Only the exported area, at most STROKE_MASK_MAX_PIXELS (its edges are hard, so a coarser mask stays clean).
  const k = Math.min(want, Math.sqrt(STROKE_MASK_MAX_PIXELS / Math.max(1, box.w * box.h)));
  const mask = createCanvas(Math.max(1, Math.ceil(box.w * k)), Math.max(1, Math.ceil(box.h * k)));
  const ctx = ctx2d(mask);
  for (const l of kept) {
    ctx.save();
    ctx.setTransform(k, 0, 0, k, -box.x * k, -box.y * k);
    const ids = l.type === 'raster' ? strokes.get(l.id) : undefined;
    if (ids) footprint(ctx, l as RasterLayer, ids);
    else drawLayer(ctx, { ...l, opacity: 1, blend: 'normal' } as Layer);
    ctx.restore();
  }
  // Coverage, not opacity: the kept pixels carry their own soft edges, so a soft mask would fade them twice.
  const img = ctx.getImageData(0, 0, mask.width, mask.height), px = img.data;
  for (let i = 3; i < px.length; i += 4) if (px[i]) px[i] = 255;
  ctx.putImageData(img, 0, 0);
  return mask;
}

function footprint(ctx: CanvasRenderingContext2D, l: RasterLayer, ids: Set<string>): void {
  const surface = getRasterSurface(l.id);
  const fw = surface?.fw ?? l.pxWidth ?? l.width, fh = surface?.fh ?? l.pxHeight ?? l.height;
  if (l.transform) ctx.transform(...l.transform);
  ctx.translate(l.x, l.y);
  ctx.scale(l.width / fw, l.height / fh);
  for (const s of l.paintStrokes ?? []) if (ids.has(s.id)) drawRasterStroke(ctx, { ...s, color: '#000', opacity: 1, erase: false }, 0, 0);
}
