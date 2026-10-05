import type { RasterLayer, VectorLayer } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { apply, invert, mapBox, multiply, type Mat } from './matrix';
import { getBuffer } from './raster';

const cache = new WeakMap<VectorLayer, { mask: HTMLCanvasElement; pixels: HTMLCanvasElement }>();

export function maskFrame(mask: RasterLayer): Mat {
  return multiply(mask.transform ?? [1, 0, 0, 1, 0, 0], [mask.width / mask.pxWidth, 0, 0, mask.height / mask.pxHeight, mask.x, mask.y]);
}

export function maskContains(layer: VectorLayer, x: number, y: number): boolean {
  if (!layer.pixelMask) return true;
  const mask = layer.pixelMask, pixels = getBuffer(mask.id);
  if (!pixels) return false;
  const [px, py] = apply(invert(maskFrame(mask)), x, y);
  return px >= 0 && py >= 0 && px < pixels.width && py < pixels.height && ctx2d(pixels).getImageData(Math.floor(px), Math.floor(py), 1, 1).data[3] > 0;
}

/** Rasterize only the display cache; the layer retains every editable shape and pressure stroke. */
export function drawMaskedVector(ctx: CanvasRenderingContext2D, layer: VectorLayer, paint: (ctx: CanvasRenderingContext2D) => void): void {
  const mask = layer.pixelMask!;
  const pixels = getBuffer(mask.id);
  if (!pixels) return;
  let entry = cache.get(layer);
  if (!entry || entry.mask !== pixels) {
    const out = createCanvas(pixels.width, pixels.height), c = ctx2d(out);
    c.setTransform(...invert(maskFrame(mask)));
    paint(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(pixels, 0, 0);
    entry = { mask: pixels, pixels: out };
    cache.set(layer, entry);
  }
  ctx.save();
  ctx.transform(...maskFrame(mask));
  ctx.drawImage(entry.pixels, 0, 0);
  ctx.restore();
}


const bounds = new WeakMap<HTMLCanvasElement, { x: number; y: number; w: number; h: number } | null>();
export function maskBounds(mask: RasterLayer) {
  const pixels = getBuffer(mask.id);
  if (!pixels) return null;
  if (!bounds.has(pixels)) {
    const data = ctx2d(pixels).getImageData(0, 0, pixels.width, pixels.height).data;
    let x0 = pixels.width, y0 = pixels.height, x1 = -1, y1 = -1;
    for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
      if (!data[(y * pixels.width + x) * 4 + 3]) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    bounds.set(pixels, x1 < 0 ? null : { x: x0, y: y0, w: x1 + 1 - x0, h: y1 + 1 - y0 });
  }
  const b = bounds.get(pixels);
  return b ? mapBox(maskFrame(mask), b) : null;
}

export function allVectorObjects(layer: VectorLayer, ids: string[] | null): boolean {
  return !ids || [...layer.shapes, ...(layer.strokes ?? [])].every(s => ids.includes(s.id));
}
