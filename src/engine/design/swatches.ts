import type { DesignDoc } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { setUi, useStore } from '../../store/store';
import { drawDoc } from './render';
import { renderSource, type SampleSource } from './sampleSource';
import { peekPixel } from './framePeek';

/* Designer colors: recent ones (newest first) and saved ones, kept with the UI settings. */

const RECENT_MAX = 12;
const SAVED_MAX = 40;

const norm = (c: string) => c.trim().toLowerCase();
const swatches = () => useStore.getState().ui.swatches ?? { recent: [], saved: [] };

/** A color the user chose or picked: first in Recent, without duplicates. */
export function rememberColor(color: string): void {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  const s = swatches();
  const c = norm(color);
  if (s.recent[0] === c) return;
  setUi({ swatches: { ...s, recent: [c, ...s.recent.filter((x) => x !== c)].slice(0, RECENT_MAX) } });
}

export function saveSwatch(color: string): void {
  const s = swatches();
  const c = norm(color);
  if (s.saved.includes(c)) return;
  setUi({ swatches: { ...s, saved: [...s.saved, c].slice(-SAVED_MAX) } });
}

export function removeSwatch(color: string): void {
  const s = swatches();
  setUi({ swatches: { ...s, saved: s.saved.filter((x) => x !== norm(color)) } });
}

const hex = (n: number) => n.toString(16).padStart(2, '0');

/** Samples are square windows of (2r+1)² pixels; r is clamped to this. */
export const SAMPLE_RADIUS_MAX = 15;
export const clampRadius = (r: unknown) => Math.round(Math.max(0, Math.min(SAMPLE_RADIUS_MAX, typeof r === 'number' && Number.isFinite(r) ? r : 0)));

/**
 * The average color of the (2r+1)² window around (cx, cy) in an RGBA sheet of sw×sh pixels, as #rrggbb. Weighted by alpha
 * (premultiplied), so transparent pixels do not darken it. Null when the window is outside the sheet or fully transparent.
 */
export function averageColor(data: Uint8ClampedArray, sw: number, sh: number, cx: number, cy: number, radius: number): string | null {
  let r = 0, g = 0, b = 0, a = 0;
  for (let y = Math.max(0, cy - radius); y <= Math.min(sh - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius), p = (y * sw + x) * 4; x <= Math.min(sw - 1, cx + radius); x++, p += 4) {
      const w = data[p + 3];
      r += data[p] * w; g += data[p + 1] * w; b += data[p + 2] * w; a += w;
    }
  }
  return a ? `#${hex(Math.round(r / a))}${hex(Math.round(g / a))}${hex(Math.round(b / a))}` : null;
}

/**
 * The visible color at a point of the page (all visible layers and the background), as #rrggbb.
 * Reads the editor's already composed page when it is the current one; otherwise renders only that pixel: the document is
 * drawn into a 1×1 canvas shifted to the point.
 * Options: `radius` averages a square window of (2r+1)² pixels; `source: 'layer'` reads only the active layer's own pixels.
 * Without options it is the single visible pixel. `onReason` hears why nothing could be read (pixels still loading, no layer).
 * Null outside the page or where nothing is drawn (fully transparent).
 */
export function sampleColor(doc: DesignDoc, x: number, y: number, o: { radius?: number; source?: SampleSource; onReason?: (why: string) => void } = {}): string | null {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  const radius = clampRadius(o.radius), source = o.source ?? 'all';
  if (!radius && source === 'all') {
    const seen = peekPixel(doc, x, y);
    if (seen) return seen[3] ? `#${hex(seen[0])}${hex(seen[1])}${hex(seen[2])}` : null;
    const canvas = createCanvas(1, 1);
    const ctx = ctx2d(canvas);
    ctx.translate(-Math.floor(x), -Math.floor(y));
    drawDoc(ctx, doc, { origin: 'color-sample' });
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (!a) return null;
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  const px = Math.floor(x), py = Math.floor(y);
  const x0 = Math.max(0, px - radius), y0 = Math.max(0, py - radius);
  const rect = { x: x0, y: y0, w: Math.min(Math.round(doc.width), px + radius + 1) - x0, h: Math.min(Math.round(doc.height), py + radius + 1) - y0 };
  const read = renderSource(doc, source, { origin: 'color-sample', rect });
  if (typeof read === 'string') { o.onReason?.(read); return null; }
  return averageColor(ctx2d(read.canvas).getImageData(0, 0, rect.w, rect.h).data, rect.w, rect.h, px - x0, py - y0, radius);
}
