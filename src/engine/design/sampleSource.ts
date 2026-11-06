import type { DesignDoc } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import type { RenderOrigin } from '../../lib/renderTrace';
import { activeLayer } from './doc';
import { drawDoc, drawLayer } from './render';
import { getRasterSurface } from './raster';
import { pixelsNotReady } from './rasterMissing';

export type SampleSource = 'all' | 'layer';
type Rect = { x: number; y: number; w: number; h: number };

/**
 * What the Fill and the Eyedropper read: everything visible ('all') or the active layer's own pixels ('layer'), drawn into a
 * canvas the size of `rect` (default the whole page). Returns the canvas, or why not (pixels still loading, no layer).
 */
export function renderSource(doc: DesignDoc, source: SampleSource, opts: { origin: RenderOrigin; rect?: Rect }): { canvas: HTMLCanvasElement } | string {
  const r = opts.rect ?? { x: 0, y: 0, w: Math.round(doc.width), h: Math.round(doc.height) };
  const only = source === 'layer' ? activeLayer(doc) : null;
  if (source === 'layer' && !only) return 'Select a layer first, or sample all layers.';
  const layers = only ? [only] : doc.layers;
  const missing = layers.filter((l) => (only || l.visible) && l.type === 'raster' && !getRasterSurface(l.id));
  if (missing.length) return pixelsNotReady(missing.map((l) => l.id));
  const canvas = createCanvas(r.w, r.h);
  const ctx = ctx2d(canvas);
  ctx.translate(-r.x, -r.y);
  // The layer's own pixels (plain: no opacity, no blend), even when it is hidden.
  if (only) drawLayer(ctx, { ...only, visible: true, opacity: 1 }, true); else drawDoc(ctx, doc, { origin: opts.origin });
  return { canvas };
}
