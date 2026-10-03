import type { DesignDoc } from '../types';
import { getDoc, mutateDoc, rebasePaintLayer } from './actions';
import { translateLayer, unionBox } from './doc';
import { layerBox } from './render';
import { setSelection } from './pixelSelection';

/* Page size of a design: set it with an anchor, or trim it to what is drawn. Layers keep their pixels; they move so
   the anchored part of the page stays where it was. One undo step. */

export type Anchor = `${'top' | 'middle' | 'bottom'}-${'left' | 'center' | 'right'}`;
export const ANCHORS: Anchor[] = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
export const MAX_SIDE = 8192;

/** Where the old page lands inside the new one for an anchor. */
export function anchorOffset(from: { width: number; height: number }, to: { width: number; height: number }, anchor: Anchor): { dx: number; dy: number } {
  const [v, h] = anchor.split('-');
  const fx = h === 'left' ? 0 : h === 'center' ? 0.5 : 1;
  const fy = v === 'top' ? 0 : v === 'middle' ? 0.5 : 1;
  return { dx: Math.round((to.width - from.width) * fx), dy: Math.round((to.height - from.height) * fy) };
}

function resizeBy(sessionId: string, docId: string, width: number, height: number, dx: number, dy: number): void {
  mutateDoc(sessionId, docId, (d: DesignDoc) => ({ ...d, width, height, updatedAt: Date.now(), layers: d.layers.map((l) => translateLayer(l, dx, dy)) }));
  // A pixel selection was drawn on the old page: it no longer matches.
  setSelection(docId, null);
  // Page-sized paint layers follow the new page, so the brush reaches all of it.
  const doc = getDoc(sessionId, docId);
  for (const l of doc?.layers ?? []) if (l.type === 'raster' && !l.sourceAssetId) rebasePaintLayer(sessionId, docId, l.id);
}

/** Set the page size; an error message if the size is not valid. */
export function resizeCanvas(sessionId: string, docId: string, width: number, height: number, anchor: Anchor): string | null {
  const doc = getDoc(sessionId, docId);
  if (!doc) return 'No design.';
  const w = Math.round(width), h = Math.round(height);
  if (!(w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE)) return `Width and height go from 1 to ${MAX_SIDE} px.`;
  if (w === doc.width && h === doc.height) return null;
  const { dx, dy } = anchorOffset(doc, { width: w, height: h }, anchor);
  resizeBy(sessionId, docId, w, h, dx, dy);
  return null;
}

/** The page shrinks (or grows) to the box of every visible layer. */
export function trimToContent(sessionId: string, docId: string): string | null {
  const doc = getDoc(sessionId, docId);
  if (!doc) return 'No design.';
  const box = unionBox(doc.layers.filter((l) => l.visible).map(layerBox).filter((b): b is NonNullable<typeof b> => Boolean(b)));
  if (!box || box.w < 1 || box.h < 1) return 'Nothing is drawn to trim to.';
  const x = Math.floor(box.x), y = Math.floor(box.y);
  const w = Math.min(MAX_SIDE, Math.ceil(box.x + box.w) - x), h = Math.min(MAX_SIDE, Math.ceil(box.y + box.h) - y);
  if (x === 0 && y === 0 && w === doc.width && h === doc.height) return null;
  resizeBy(sessionId, docId, w, h, -x, -y);
  return null;
}
