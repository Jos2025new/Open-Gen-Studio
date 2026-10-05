import type { DesignDoc } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { setDoc } from '../../store/store';
import { insertLayer, newRasterLayer } from './doc';
import { drawDoc } from './render';
import { getBuffer, setBuffer } from './raster';
import { record } from './history';
import { getSelection, selectionMask } from './pixelSelection';

/** Sample visible colors, keeping the fill separate from the source artwork. */
export function fillRegion(sessionId: string, doc: DesignDoc, x: number, y: number, color: string, opacity: number, options: { threshold?: number; expand?: number; smooth?: number } = {}): void {
  const threshold = Math.max(0, Math.min(255, options.threshold ?? 24));
  const expand = Math.round(Math.max(0, Math.min(12, options.expand ?? 0)));
  const smooth = Math.max(0, Math.min(4, options.smooth ?? 0));
  const w = Math.round(doc.width), h = Math.round(doc.height);
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  if (doc.layers.some((l) => l.visible && l.type === 'raster' && !getBuffer(l.id))) throw new Error('Layer pixels are still loading. Try again in a moment.');
  const canvas = createCanvas(w, h);
  const ctx = ctx2d(canvas);
  drawDoc(ctx, doc);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const region = floodMask(pixels, w, h, x, y, threshold, expand);
  const out = ctx.createImageData(w, h);
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let i = 0; i < region.length; i++) {
    if (!region[i]) continue;
    const p = i * 4;
    out.data[p] = rgb[0]; out.data[p + 1] = rgb[1]; out.data[p + 2] = rgb[2]; out.data[p + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  if (smooth > 0) {
    const mask = createCanvas(w, h);
    ctx2d(mask).drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.filter = `blur(${smooth}px)`;
    ctx.drawImage(mask, 0, 0);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  // With a pixel selection, the fill stays inside it.
  const sel = getSelection(doc.id);
  if (sel) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(selectionMask(doc, sel), 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  const layer = { ...newRasterLayer('Fill', { x: 0, y: 0, width: doc.width, height: doc.height }, { width: w, height: h }), opacity };
  if (!sel && region.every(value => value === 1) && smooth === 0) Object.assign(layer, { pageFill: { color, rev: layer.rev } });
  record(doc);
  setBuffer(layer.id, canvas);
  setDoc(sessionId, doc.id, (d) => insertLayer(d, layer, 'top'));
}

/**
 * The pixels contiguous with (x, y) whose color is within `threshold` of it (per channel, premultiplied, alpha too),
 * then grown `expand` pixels. Shared by the bucket and the magic wand. 1 = in the region.
 */
export function floodMask(pixels: Uint8ClampedArray, w: number, h: number, x: number, y: number, threshold: number, expand: number): Uint8Array {
  const seed = (y * w + x) * 4;
  const alpha = pixels[seed + 3];
  const matches = (i: number) => {
    const p = i * 4, a = pixels[p + 3];
    if (Math.abs(a - alpha) > threshold) return false;
    for (let c = 0; c < 3; c++) if (Math.abs(pixels[p + c] * a / 255 - pixels[seed + c] * alpha / 255) > threshold) return false;
    return true;
  };
  const seen = new Uint8Array(w * h);
  const region = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 1;
  queue[0] = y * w + x;
  seen[queue[0]] = 1;
  const visit = (i: number) => {
    if (seen[i]) return;
    seen[i] = 1;
    if (matches(i)) queue[tail++] = i;
  };
  while (head < tail) {
    const i = queue[head++], col = i % w;
    region[i] = 1;
    if (col > 0) visit(i - 1);
    if (col < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < w * (h - 1)) visit(i + w);
  }
  // Grow in bounded waves, reusing the flood queue; every pixel is added at most once.
  head = 0;
  const grow = (i: number) => {
    if (region[i]) return;
    region[i] = 1;
    queue[tail++] = i;
  };
  for (let step = 0; step < expand; step++) {
    const end = tail;
    while (head < end) {
      const i = queue[head++], col = i % w;
      if (col > 0) grow(i - 1);
      if (col < w - 1) grow(i + 1);
      if (i >= w) grow(i - w);
      if (i < w * (h - 1)) grow(i + w);
    }
  }
  return region;
}
