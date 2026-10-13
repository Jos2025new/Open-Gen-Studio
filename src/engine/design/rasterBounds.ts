import type { Layer } from '../types';
import { unionBox, type Box } from './doc';
import { bufferVersion, getRasterSurface, paintingLive } from './raster';
import type { RasterSurface } from './rasterSurface';
import { rasterStrokeBox } from './rasterStrokes';

/** The box of pixels with alpha above 8, found from the outside in. */
export function alphaBounds(px: Uint32Array, width: number, height: number, threshold = 8): { x0: number; y0: number; x1: number; y1: number } | null {
  const solid = (i: number) => (px[i] >>> 24) > threshold;
  let y0 = 0;
  for (; y0 < height; y0++) { const r = y0 * width; let x = 0; while (x < width && !solid(r + x)) x++; if (x < width) break; }
  if (y0 === height) return null;
  let y1 = height - 1;
  for (; y1 > y0; y1--) { const r = y1 * width; let x = 0; while (x < width && !solid(r + x)) x++; if (x < width) break; }
  let x0 = width, x1 = -1;
  for (let y = y0; y <= y1; y++) {
    const r = y * width;
    for (let x = 0; x < x0; x++) if (solid(r + x)) { x0 = x; break; }
    for (let x = width - 1; x > x1; x--) if (solid(r + x)) { x1 = x; break; }
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

const painted = new WeakMap<HTMLCanvasElement, Map<number, { version: number; box: ReturnType<typeof alphaBounds> }>>();
// Last measured bounds per layer ID survive immutable canvas replacement. A pending dirty rect is unioned into them.
const byLayer = new Map<string, { version: number; box: ReturnType<typeof alphaBounds>; exact: boolean }>();
function rememberLayerBox(id: string, version: number, box: ReturnType<typeof alphaBounds>, exact: boolean): void {
  byLayer.delete(id);
  byLayer.set(id, { version, box, exact });
  if (byLayer.size > 512) byLayer.delete(byLayer.keys().next().value!);
}
/** Keep total layer bounds conservative after a write without reading the changed canvas back. */
export function extendRasterBounds(id: string, version: number, width: number, height: number, dirty: { x0: number; y0: number; x1: number; y1: number } | 'all'): void {
  const cached = byLayer.get(id);
  // Box sampling runs before dirty consumption in retainedFrame. An all-dirty buffer already sampled at this version
  // needs a full redraw, but its exact total painted bounds remain known.
  if (dirty === 'all' && cached?.version === version && cached.exact) return;
  const previous = cached?.box;
  const next = dirty === 'all' || !previous
    ? { x0: 0, y0: 0, x1: width, y1: height }
    : { x0: Math.min(previous.x0, dirty.x0), y0: Math.min(previous.y0, dirty.y0), x1: Math.max(previous.x1, dirty.x1), y1: Math.max(previous.y1, dirty.y1) };
  rememberLayerBox(id, version, next, false);
}
/** Bounds follow each canvas content version; live paint uses the dirty region until the stroke ends. */
export function pixelBox(buf: HTMLCanvasElement, version: number, readPixels = true, threshold = 8): ReturnType<typeof alphaBounds> | undefined {
  let boxes = painted.get(buf);
  if (!boxes) { boxes = new Map(); painted.set(buf, boxes); }
  let hit = boxes.get(threshold);
  if (!readPixels) return hit?.box;
  if (!hit || (hit.version !== version && !paintingLive())) {
    const width = buf.width, height = buf.height;
    const d = buf.getContext('2d')!.getImageData(0, 0, width, height).data;
    hit = { version, box: alphaBounds(new Uint32Array(d.buffer, d.byteOffset, width * height), width, height, threshold) };
    boxes.set(threshold, hit);
  }
  return hit.box;
}

function layerPixelBox(id: string, buf: HTMLCanvasElement, version: number, readPixels: boolean): ReturnType<typeof alphaBounds> | undefined {
  const previous = byLayer.get(id);
  if (!readPixels) {
    if (previous) { rememberLayerBox(id, previous.version, previous.box, previous.exact); return previous.box; }
    return pixelBox(buf, version, false, 0);
  }
  if (previous?.version === version && previous.exact) { rememberLayerBox(id, version, previous.box, true); return previous.box; }
  // A live stroke may mutate its canvas before the next version is committed; keep its dirty bound conservative and
  // defer the alpha scan until the stroke is idle instead of promoting a stale pixelBox hit to an exact new version.
  if (paintingLive()) return previous?.box ?? pixelBox(buf, version, false, 0);
  const box = pixelBox(buf, version, true, 0);
  if (box !== undefined) rememberLayerBox(id, version, box, true);
  return box;
}

/** Bounds of visible raster pixels before a layer transform; source assets fall back to their placement. */
export function rasterPaintedBox(l: Extract<Layer, { type: 'raster' }>, readPixels = true, includeComposite = false): Box | null | undefined {
  if (l.sourceAssetId) return undefined;
  const surface = getRasterSurface(l.id);
  if (!surface || !surface.canvas.width || !surface.canvas.height) return undefined;
  const buf = surface.canvas;
  // Boxes are measured in their own canvas and placed back in the full buffer (fw × fh pixels, as the layer's size).
  const toPage = (b: NonNullable<ReturnType<typeof alphaBounds>>, s: RasterSurface): Box => {
    const kx = l.width / s.fw, ky = l.height / s.fh;
    return { x: l.x + (s.x0 + b.x0) * kx, y: l.y + (s.y0 + b.y0) * ky, w: (b.x1 - b.x0) * kx, h: (b.y1 - b.y0) * ky };
  };
  const base = l.paintBaseId ? getRasterSurface(l.paintBaseId) : undefined;
  if (base?.canvas.width && l.paintStrokes) {
    const b0 = layerPixelBox(l.paintBaseId!, base.canvas, bufferVersion(l.paintBaseId!), readPixels);
    const composed = includeComposite ? layerPixelBox(l.id, buf, bufferVersion(l.id), readPixels) : undefined;
    const all = unionBox([...(b0 ? [toPage(b0, base)] : []), ...(composed ? [toPage(composed, surface)] : []), ...l.paintStrokes.map((st) => rasterStrokeBox(l, st)).filter((b): b is Box => b != null)]);
    if (!all) return null;
    const x0 = Math.max(all.x, l.x), y0 = Math.max(all.y, l.y), x1 = Math.min(all.x + all.w, l.x + l.width), y1 = Math.min(all.y + all.h, l.y + l.height);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  const box = layerPixelBox(l.id, buf, bufferVersion(l.id), readPixels);
  return box ? toPage(box, surface) : null;
}
