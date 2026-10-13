import { createCanvas, ctx2d } from '../../../lib/media';
import type { Box, RasterItem } from './structure';

/*
 * The elements the editor cannot hold as shapes (gradients, text, clip paths, masks, filters, patterns, images) are
 * drawn alone, with their inherited style, and placed as a raster layer at their own page box. resvg-wasm
 * (MPL-2.0; loaded the first time it is needed) draws everything except text, which needs fonts it does not have;
 * text, and anything resvg fails on, is drawn by the browser from the sanitized SVG of that element only.
 */

export interface Rasterized { box: Box; canvas: HTMLCanvasElement; engine: 'resvg' | 'browser' }
export type Rasterizer = (item: RasterItem, page: { width: number; height: number }) => Promise<Rasterized | null>;

const MAX_PIXELS = 16_000_000;
type ResvgModule = typeof import('@resvg/resvg-wasm');
let resvg: Promise<ResvgModule | null> | undefined;

/** resvg-wasm, started once; three attempts, then null (the browser draws instead). */
export function loadResvg(): Promise<ResvgModule | null> {
  resvg ??= (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const mod = await import('@resvg/resvg-wasm');
        const url = (await import('@resvg/resvg-wasm/index_bg.wasm?url')).default;
        await mod.initWasm(fetch(url));
        return mod;
      } catch { /* try again */ }
    }
    return null;
  })();
  return resvg;
}

const clip = (b: Box, page: { width: number; height: number }): Box | null => {
  const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
  const w = Math.min(page.width, Math.ceil(b.x + b.w)) - x, h = Math.min(page.height, Math.ceil(b.y + b.h)) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};
const scaleFor = (b: Box) => Math.min(1, Math.sqrt(MAX_PIXELS / (b.w * b.h)));

export async function rasterizeWithResvg(item: RasterItem, page: { width: number; height: number }, mod: ResvgModule): Promise<Rasterized | null> {
  const probe = new mod.Resvg(item.svgFor({ x: 0, y: 0, w: page.width, h: page.height }, 1));
  const bb = probe.getBBox();
  probe.free();
  const box = clip(bb ? { x: bb.x - 1, y: bb.y - 1, w: bb.width + 2, h: bb.height + 2 } : item.hint, page);
  if (!box) return null;
  const r = new mod.Resvg(item.svgFor(box, scaleFor(box))).render();
  const { width, height } = r, src = r.pixels, out = new Uint8ClampedArray(src.length);
  // resvg returns premultiplied RGBA; canvas ImageData is straight.
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    out[i + 3] = a;
    if (a === 255) { out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2]; } else if (a) { out[i] = Math.min(255, Math.round((src[i] * 255) / a)); out[i + 1] = Math.min(255, Math.round((src[i + 1] * 255) / a)); out[i + 2] = Math.min(255, Math.round((src[i + 2] * 255) / a)); }
  }
  const canvas = createCanvas(width, height);
  ctx2d(canvas).putImageData(new ImageData(out, width, height), 0, 0);
  return { box, canvas, engine: 'resvg' };
}

async function withBrowser(item: RasterItem, page: { width: number; height: number }): Promise<Rasterized | null> {
  // Text has no geometry to measure: look in its estimated box, grown, then trim to what was drawn.
  const grow = item.text ? Math.max(12, item.hint.h, item.hint.w * 0.5) : 2;
  const box = clip({ x: item.hint.x - grow, y: item.hint.y - grow, w: item.hint.w + 2 * grow, h: item.hint.h + 2 * grow }, page);
  if (!box) return null;
  const scale = scaleFor(box);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(item.svgFor(box, scale));
  await img.decode();
  const w = Math.max(1, Math.ceil(box.w * scale)), h = Math.max(1, Math.ceil(box.h * scale));
  const canvas = createCanvas(w, h), c = ctx2d(canvas);
  c.drawImage(img, 0, 0, w, h);
  // Trim to the painted pixels.
  const data = c.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const tw = x1 - x0 + 1, th = y1 - y0 + 1, trimmed = createCanvas(tw, th);
  ctx2d(trimmed).drawImage(canvas, x0, y0, tw, th, 0, 0, tw, th);
  return { box: { x: box.x + x0 / scale, y: box.y + y0 / scale, w: tw / scale, h: th / scale }, canvas: trimmed, engine: 'browser' };
}

/** resvg first (not for text); the browser when resvg is unavailable, throws or draws nothing for text. */
export const defaultRasterizer: Rasterizer = async (item, page) => {
  if (!item.text) {
    const mod = await loadResvg();
    if (mod) { try { const r = await rasterizeWithResvg(item, page, mod); if (r) return r; } catch { /* fall through */ } }
  }
  try { return await withBrowser(item, page); } catch { return null; }
};
