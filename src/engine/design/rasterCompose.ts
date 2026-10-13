import type { RasterLayer, RasterStroke } from '../types';
import { ctx2d } from '../../lib/media';
import { span } from '../../lib/trace';
import { drawRasterStroke } from './rasterDraw';
import { rasterStrokeMask } from './rasterStrokeMask';
import { getRasterSurface, setBuffer, type Dirty } from './raster';
import { allocBox, geometryOf, growTo, regionOf, unionRegion, type Region } from './rasterSurface';

/* Compositions of a raster layer's base and strokes (composeRaster, composeMoving), moved out of raster.ts (AGENTS: 30 KB). */

/** The area one stroke can paint, in full-buffer pixels. */
function strokeRegion(s: RasterStroke): Region | null {
  if (!s.segments.length) return null;
  if (s.tip) { const m = rasterStrokeMask(s, s.tip); return { x0: m.x + s.x, y0: m.y + s.y, x1: m.x + s.x + m.canvas.width, y1: m.y + s.y + m.canvas.height }; }
  const d = strokeBufferBox(s);
  return d === 'all' ? null : { x0: d.x0 - 2, y0: d.y0 - 2, x1: d.x1 + 2, y1: d.y1 + 2 };
}

/** Draw a stored box into a canvas placed at (ox, oy) of the full buffer. */
function drawBox(ctx: CanvasRenderingContext2D, s: HTMLCanvasElement, ox: number, oy: number): void {
  if (!s.width || !s.height) return;
  const g = geometryOf(s);
  ctx.drawImage(s, g.x0 - ox, g.y0 - oy);
}

/** Rebuild only after moving an object; ordinary painting keeps its incremental renderer. */
export function composeRaster(layer: RasterLayer, persist = true, dirty: Dirty = 'all'): boolean {
  const base = layer.paintBaseId && getRasterSurface(layer.paintBaseId);
  if (!base) return false;
  const strokes = layer.paintStrokes ?? [];
  const end = span('raster', 'compose', { strokes: strokes.length, pixels: base.canvas.width * base.canvas.height });
  const canvas = allocBox(unionRegion([regionOf(base.canvas), ...strokes.map(strokeRegion)], base.fw, base.fh), base.fw, base.fh);
  const ctx = ctx2d(canvas), g = geometryOf(canvas);
  drawBox(ctx, base.canvas, g.x0, g.y0);
  for (const stroke of strokes) drawRasterStroke(ctx, stroke, g.x0, g.y0);
  setBuffer(layer.id, canvas, persist, dirty);
  end();
  return true;
}

/**
 * Moving some strokes of a painted layer: composeRaster for every frame of the drag, without its cost. What lies under
 * the first moving stroke (the base and the strokes before it) is drawn once; each frame copies it into one reused
 * canvas and draws only the strokes from there on, in the same order, so the pixels are the same. The layer's buffer
 * before the drag is never written (undo keeps it). Null while the base is not loaded.
 */
export function composeMoving(layer: RasterLayer, ids: readonly string[]): ((moved: RasterLayer) => void) | null {
  const base = layer.paintBaseId && getRasterSurface(layer.paintBaseId);
  if (!base) return null;
  const moving = new Set(ids);
  const strokes = layer.paintStrokes ?? [];
  const first = Math.max(0, strokes.findIndex((s) => moving.has(s.id)));
  const fw = base.fw, fh = base.fh;
  const underRegion = unionRegion([regionOf(base.canvas), ...strokes.slice(0, first).map(strokeRegion)], fw, fh);
  const under = allocBox(underRegion, fw, fh), ug = geometryOf(under);
  const uctx = ctx2d(under);
  drawBox(uctx, base.canvas, ug.x0, ug.y0);
  for (const stroke of strokes.slice(0, first)) drawRasterStroke(uctx, stroke, ug.x0, ug.y0);
  let work: HTMLCanvasElement | undefined;
  return (moved) => {
    const end = span('raster', 'compose', { strokes: (moved.paintStrokes?.length ?? 0) - first, pixels: base.canvas.width * base.canvas.height });
    const after = (moved.paintStrokes ?? []).slice(first);
    // The work canvas keeps its place while the drag stays inside it: one canvas for the whole drag.
    const need = unionRegion([regionOf(under), ...after.map(strokeRegion)], fw, fh);
    work = need ? (work ? growTo(work, need) : allocBox(need, fw, fh)) : (work ?? allocBox(null, fw, fh));
    const wg = geometryOf(work), ctx = ctx2d(work);
    // 'copy' clears everything outside the drawn box, as the work canvas must start empty each frame.
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    drawBox(ctx, under, wg.x0, wg.y0);
    ctx.restore();
    for (const stroke of after) drawRasterStroke(ctx, stroke, wg.x0, wg.y0);
    // What changed: the moving strokes, where they were and where they are now.
    const before = strokes.filter((x) => moving.has(x.id)).map(strokeBufferBox);
    const now = (moved.paintStrokes ?? []).filter((x) => moving.has(x.id)).map(strokeBufferBox);
    setBuffer(layer.id, work, false, unionOf([...before, ...now]));
    end();
  };
}

/** Bounds of a stroke in buffer pixels, its offset included, with its widest reach. */
export function strokeBufferBox(s: RasterStroke): Dirty {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [ax, ay, bx, by, w] of s.segments) {
    const r = w / 2 + 2;
    x0 = Math.min(x0, ax - r, bx - r); y0 = Math.min(y0, ay - r, by - r);
    x1 = Math.max(x1, ax + r, bx + r); y1 = Math.max(y1, ay + r, by + r);
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0: x0 + s.x, y0: y0 + s.y, x1: x1 + s.x, y1: y1 + s.y };
}
function unionOf(list: Dirty[]): Dirty {
  if (list.some((d) => d === 'all')) return 'all';
  const rs = list as Array<Exclude<Dirty, 'all'>>;
  if (!rs.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0: Math.min(...rs.map((r) => r.x0)), y0: Math.min(...rs.map((r) => r.y0)), x1: Math.max(...rs.map((r) => r.x1)), y1: Math.max(...rs.map((r) => r.y1)) };
}

