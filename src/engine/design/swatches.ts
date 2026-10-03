import type { DesignDoc } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { setUi, useStore } from '../../store/store';
import { drawDoc } from './render';

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

/**
 * The visible color at a point of the page (all visible layers and the background), as #rrggbb.
 * Renders only that pixel: the document is drawn into a 1×1 canvas shifted to the point.
 * Null outside the page or where nothing is drawn (fully transparent).
 */
export function sampleColor(doc: DesignDoc, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  const canvas = createCanvas(1, 1);
  const ctx = ctx2d(canvas);
  ctx.translate(-Math.floor(x), -Math.floor(y));
  drawDoc(ctx, doc);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (!a) return null;
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
