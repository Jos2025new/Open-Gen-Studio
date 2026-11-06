import type { DesignDoc } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { setDoc, toast } from '../../store/store';
import { insertLayer, newRasterLayer } from './doc';
import { renderSource, type SampleSource } from './sampleSource';
import { setBuffer } from './raster';
import { record } from './history';
import { getSelection, selectionMask } from './pixelSelection';
import { colorMatcher, gapMask, similarMask } from './fillGap';

export type FillOptions = {
  threshold?: number; expand?: number; smooth?: number;
  /** What the fill reads: everything visible, or the active layer's own pixels (the fill then lands right under that layer). */
  source?: SampleSource;
  /** Openings in the outline up to this many pixels (0..16) do not let the fill leak. Ignored with `similar`. */
  gap?: number;
  /** Every similar pixel of the page, not only the ones connected to the click. */
  similar?: boolean;
};

/** Sample the chosen source, keeping the fill separate from the source artwork. */
export function fillRegion(sessionId: string, doc: DesignDoc, x: number, y: number, color: string, opacity: number, options: FillOptions = {}): void {
  const threshold = Math.max(0, Math.min(255, options.threshold ?? 24));
  const expand = Math.round(Math.max(0, Math.min(12, options.expand ?? 0)));
  const smooth = Math.max(0, Math.min(4, options.smooth ?? 0));
  const w = Math.round(doc.width), h = Math.round(doc.height);
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const source = options.source ?? 'all';
  const gap = Math.round(Math.max(0, Math.min(16, options.gap ?? 0)));
  const read = renderSource(doc, source, { origin: 'fill' });
  if (typeof read === 'string') throw new Error(read);
  const { canvas } = read;
  const ctx = ctx2d(canvas);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  let region: Uint8Array | null = null;
  if (options.similar) region = similarMask(pixels, w, h, x, y, threshold, expand);
  else if (gap > 0) {
    region = gapMask(pixels, w, h, x, y, threshold, gap, expand);
    if (!region) toast('Too close to the outline to close gaps: filled without closing them.', 'info');
  }
  region ??= floodMask(pixels, w, h, x, y, threshold, expand);
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
  setDoc(sessionId, doc.id, (d) => insertLayer(d, layer, source === 'layer' ? 'below' : 'top'));
}

/**
 * The pixels contiguous with (x, y) whose color is within `threshold` of it (per channel, premultiplied, alpha too),
 * then grown `expand` pixels. Shared by the bucket and the magic wand. 1 = in the region.
 */
export function floodMask(pixels: Uint8ClampedArray, w: number, h: number, x: number, y: number, threshold: number, expand: number): Uint8Array {
  const matches = colorMatcher(pixels, y * w + x, threshold);
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
