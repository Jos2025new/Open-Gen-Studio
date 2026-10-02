import type { DesignDoc } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { setDoc } from '../../store/store';
import { insertLayer, newRasterLayer } from './doc';
import { drawDoc } from './render';
import { getBuffer, setBuffer } from './raster';
import { record } from './history';

/** Sample visible colors, keeping the fill separate from the source artwork. */
export function fillRegion(sessionId: string, doc: DesignDoc, x: number, y: number, color: string, opacity: number): void {
  const w = Math.round(doc.width), h = Math.round(doc.height);
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  if (doc.layers.some((l) => l.visible && l.type === 'raster' && !getBuffer(l.id))) throw new Error('Layer pixels are still loading. Try again in a moment.');
  const canvas = createCanvas(w, h);
  const ctx = ctx2d(canvas);
  drawDoc(ctx, doc);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const seed = (y * w + x) * 4;
  const alpha = pixels[seed + 3];
  const matches = (i: number) => {
    const p = i * 4, a = pixels[p + 3];
    if (Math.abs(a - alpha) > 24) return false;
    for (let c = 0; c < 3; c++) if (Math.abs(pixels[p + c] * a / 255 - pixels[seed + c] * alpha / 255) > 24) return false;
    return true;
  };
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const out = ctx.createImageData(w, h);
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  let head = 0, tail = 1;
  queue[0] = y * w + x;
  seen[queue[0]] = 1;
  const visit = (i: number) => {
    if (seen[i]) return;
    seen[i] = 1;
    if (matches(i)) queue[tail++] = i;
  };
  while (head < tail) {
    const i = queue[head++], p = i * 4, col = i % w;
    out.data[p] = rgb[0]; out.data[p + 1] = rgb[1]; out.data[p + 2] = rgb[2]; out.data[p + 3] = 255;
    if (col > 0) visit(i - 1);
    if (col < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < w * (h - 1)) visit(i + w);
  }
  ctx.putImageData(out, 0, 0);
  const layer = { ...newRasterLayer('Fill', { x: 0, y: 0, width: doc.width, height: doc.height }, { width: w, height: h }), opacity };
  record(doc);
  setBuffer(layer.id, canvas);
  setDoc(sessionId, doc.id, (d) => insertLayer(d, layer, 'top'));
}
