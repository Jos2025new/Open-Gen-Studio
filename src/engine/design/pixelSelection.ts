import { useSyncExternalStore } from 'react';
import type { DesignDoc, RasterLayer } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { setDoc, toast } from '../../store/store';
import { activeLayer, insertLayer, newRasterLayer } from './doc';
import { isProtectedImage } from './rules';
import { getBuffer, setBuffer } from './raster';
import { record } from './history';

/*
 * Pixel selection of a design (rectangle or lasso): a polygon in page coordinates, optionally inverted. It lives in
 * memory per document (not saved, like the layer pick) and clips what the pixel operations touch.
 */

export interface PixelSelection {
  /** Polygon in page coordinates (a rectangle is four points). */
  points: Array<[number, number]>;
  /** Everything on the page except the polygon. */
  inverted?: boolean;
}

const byDoc = new Map<string, PixelSelection>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version += 1;
  listeners.forEach((l) => l());
};

export function getSelection(docId: string): PixelSelection | null {
  return byDoc.get(docId) ?? null;
}

export function setSelection(docId: string, sel: PixelSelection | null): void {
  if (sel && sel.points.length < 3) sel = null;
  if (sel) byDoc.set(docId, sel);
  else if (!byDoc.delete(docId)) return;
  notify();
}

/** Re-render when any selection changes. */
export function useSelectionVersion(): number {
  return useSyncExternalStore((fn) => (listeners.add(fn), () => listeners.delete(fn)), () => version);
}

export function selectAll(doc: DesignDoc): void {
  setSelection(doc.id, { points: [[0, 0], [doc.width, 0], [doc.width, doc.height], [0, doc.height]] });
}

export function invertSelection(doc: DesignDoc): void {
  const sel = getSelection(doc.id);
  if (!sel) return selectAll(doc);
  setSelection(doc.id, { ...sel, inverted: !sel.inverted });
}

/** Rectangle from two corners, as a polygon. */
export function rectPoints(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** The selected area as a path in page coordinates on `ctx` (call fill/clip with 'evenodd'). */
export function selectionPath(ctx: CanvasRenderingContext2D, doc: Pick<DesignDoc, 'width' | 'height'>, sel: PixelSelection): void {
  ctx.beginPath();
  if (sel.inverted) ctx.rect(-1e5, -1e5, 2e5 + doc.width, 2e5 + doc.height);
  sel.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/** Bounding box of the selected area, clamped to the page (whole page when inverted). */
export function selectionBox(doc: Pick<DesignDoc, 'width' | 'height'>, sel: PixelSelection): { x: number; y: number; w: number; h: number } | null {
  if (sel.inverted) return { x: 0, y: 0, w: doc.width, h: doc.height };
  const xs = sel.points.map((p) => p[0]), ys = sel.points.map((p) => p[1]);
  const x = Math.max(0, Math.floor(Math.min(...xs))), y = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(doc.width, Math.ceil(Math.max(...xs))), y1 = Math.min(doc.height, Math.ceil(Math.max(...ys)));
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}

/** The active layer if pixel operations can change it; otherwise why not. */
export function editableRaster(doc: DesignDoc): RasterLayer | string {
  const l = activeLayer(doc);
  if (!l || l.type !== 'raster') return 'Select a raster layer.';
  if (l.locked) return `"${l.name}" is locked.`;
  if (!l.visible) return `"${l.name}" is hidden.`;
  if (isProtectedImage(l)) return `"${l.name}" is a placed image. Turn on "Allow painting" in Properties to change its pixels.`;
  if (!getBuffer(l.id)) return 'Layer pixels are still loading. Try again in a moment.';
  return l;
}

/** The layer's pixels drawn on a page-sized canvas, clipped to the selection. */
function selectedPixels(doc: DesignDoc, layer: RasterLayer, sel: PixelSelection): HTMLCanvasElement {
  const out = createCanvas(Math.round(doc.width), Math.round(doc.height));
  const ctx = ctx2d(out);
  selectionPath(ctx, doc, sel);
  ctx.clip('evenodd');
  ctx.drawImage(getBuffer(layer.id)!, layer.x, layer.y, layer.width, layer.height);
  return out;
}

/**
 * Erase the selected pixels of the active raster layer. The layer is flattened (its editable strokes become pixels),
 * as rotating it does. One undo step. Returns an error message, or null.
 */
export function clearSelected(sessionId: string, doc: DesignDoc): string | null {
  const sel = getSelection(doc.id);
  if (!sel) return 'Nothing is selected.';
  const layer = editableRaster(doc);
  if (typeof layer === 'string') return layer;
  const buf = getBuffer(layer.id)!;
  const out = createCanvas(buf.width, buf.height);
  const ctx = ctx2d(out);
  ctx.drawImage(buf, 0, 0);
  // Page coordinates → this layer's pixels.
  ctx.setTransform(buf.width / layer.width, 0, 0, buf.height / layer.height, (-layer.x * buf.width) / layer.width, (-layer.y * buf.height) / layer.height);
  ctx.globalCompositeOperation = 'destination-out';
  selectionPath(ctx, doc, sel);
  ctx.fill('evenodd');
  record(doc);
  setBuffer(layer.id, out);
  setDoc(sessionId, doc.id, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => (l.id === layer.id && l.type === 'raster' ? { ...l, paintBaseId: undefined, paintStrokes: undefined, rev: l.rev + 1 } : l)) }));
  // Its strokes could be moved one by one; now they are pixels. Say so, and how to get them back.
  if (layer.paintStrokes?.length) toast(`Pixels erased. The strokes of "${layer.name}" are now part of the image and can no longer be moved one by one. Ctrl+Z undoes it.`, 'info', 6500);
  return null;
}

/** A new page-sized raster layer above the active one, from a canvas. */
function addPixelLayer(sessionId: string, doc: DesignDoc, name: string, canvas: HTMLCanvasElement, opacity = 1): void {
  const layer = { ...newRasterLayer(name, { x: 0, y: 0, width: doc.width, height: doc.height }, { width: canvas.width, height: canvas.height }), opacity };
  record(doc);
  setBuffer(layer.id, canvas);
  setDoc(sessionId, doc.id, (d) => insertLayer(d, layer, 'above'));
}

/** Copy the selected pixels of the active raster layer to a new layer above it (Ctrl+J). */
export function selectionToLayer(sessionId: string, doc: DesignDoc): string | null {
  const sel = getSelection(doc.id);
  if (!sel) return 'Nothing is selected.';
  const l = activeLayer(doc);
  if (!l || l.type !== 'raster') return 'Select a raster layer.';
  if (!getBuffer(l.id)) return 'Layer pixels are still loading. Try again in a moment.';
  addPixelLayer(sessionId, doc, `${l.name} · selection`, selectedPixels(doc, l, sel));
  return null;
}

/** Fill the selection with a color, on a new layer (like the bucket: the artwork below is untouched). */
export function fillSelection(sessionId: string, doc: DesignDoc, color: string, opacity: number): string | null {
  const sel = getSelection(doc.id);
  if (!sel) return 'Nothing is selected.';
  const out = createCanvas(Math.round(doc.width), Math.round(doc.height));
  const ctx = ctx2d(out);
  selectionPath(ctx, doc, sel);
  ctx.fillStyle = color;
  ctx.fill('evenodd');
  addPixelLayer(sessionId, doc, 'Fill', out, opacity);
  return null;
}

/** The selected pixels of the active raster layer, cropped to the selection box (for the clipboard). */
export function selectedCrop(doc: DesignDoc): HTMLCanvasElement | string {
  const sel = getSelection(doc.id);
  if (!sel) return 'Nothing is selected.';
  const l = activeLayer(doc);
  if (!l || l.type !== 'raster') return 'Select a raster layer.';
  if (!getBuffer(l.id)) return 'Layer pixels are still loading. Try again in a moment.';
  const box = selectionBox(doc, sel);
  if (!box) return 'The selection is outside the page.';
  const page = selectedPixels(doc, l, sel);
  const out = createCanvas(box.w, box.h);
  ctx2d(out).drawImage(page, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return out;
}
