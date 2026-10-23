import { rasterPending, rasterSaved, failSave } from '../../store/saveStatus';
import { span } from '../../lib/trace';
import { logged } from '../../lib/log';
import { blobDb } from '../../lib/idb';
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d } from '../../lib/media';
import { uid } from '../../lib/id';
import type { Layer, RasterLayer } from '../types';
import { toast } from '../../store/store';
import { hexRgb, segmentBox, stampSegment, type BrushTip } from './brushEngine';
import { layMask, strokeSegment } from './rasterDraw';
export { drawRasterStroke, strokeSegment } from './rasterDraw';
import { RASTER_HISTORY_TILE_SIZE, restoreRasterTiles, snapshotRasterTiles, tileKeysForRect, updateRasterTiles, type RasterHistorySnapshot } from './rasterHistoryTiles';
import { carryLayerBox, extendLayerBox } from './rasterBounds';
import { assembleFull, cropToContent, emptyBox, geometryOf, growTo, isPlaced, place, regionOf, regrid, sameBox, type Region, type RasterSurface } from './rasterSurface';

/*
 * Pixel buffers of raster layers. Buffers are treated as immutable snapshots: any edit clones the current canvas
 * first (copy-on-write), which keeps undo cheap. A buffer is stored as a box around its pixels (rasterSurface.ts):
 * getRasterSurface gives the box and its place; getBuffer gives the full buffer (assembled when the box is smaller).
 */

const buffers = new Map<string, HTMLCanvasElement>();
/** Full-buffer region the current stroke has touched, per layer: its commit extends the layer's box with it. */
const strokeSpan = new Map<string, Region>();
const listeners = new Set<() => void>();
let version = 0;

const keyFor = (layerId: string) => `raster:${layerId}`;

function notify(): void {
  version++;
  listeners.forEach((l) => l());
}

/*
 * Each buffer's own content version: bumped whenever its pixels change, live strokes included (they write in place
 * and only notify when the stroke ends). The FX cache (render.ts) keys on it, so painting one layer does not throw
 * away the cached FX of another.
 */
const contentVersions = new WeakMap<HTMLCanvasElement, number>();
let contentClock = 0;
function touchBuffer(c: HTMLCanvasElement | undefined): void {
  if (c) contentVersions.set(c, ++contentClock);
}
/** The content version of a layer's pixels (-1 = no buffer yet). */
export function bufferVersion(layerId: string): number {
  const c = buffers.get(layerId);
  return c ? contentVersions.get(c) ?? 0 : -1;
}

export function subscribeRaster(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function rasterVersion(): number {
  return version;
}

/** The stored box of a layer's pixels and its place in the full buffer (undefined = not loaded yet). */
export function getRasterSurface(layerId: string): RasterSurface | undefined {
  const canvas = buffers.get(layerId);
  return canvas && { canvas, ...geometryOf(canvas) };
}

/** The full buffer: the stored canvas when it is full, else a copy assembled for this call (cold paths only). */
export function getBuffer(layerId: string): HTMLCanvasElement | undefined {
  const canvas = buffers.get(layerId);
  return canvas && assembleFull(canvas);
}

export function snapshotBuffers(layerIds: string[]): Map<string, HTMLCanvasElement> {
  const out = new Map<string, HTMLCanvasElement>();
  for (const id of layerIds) {
    const b = buffers.get(id);
    if (b) out.set(id, b);
  }
  return out;
}

/** A dirty area in full-buffer pixels, or 'all' when the write does not say where it landed. */
export type Dirty = { x0: number; y0: number; x1: number; y1: number } | 'all';
/** Which layer a buffer belongs to (buffers are replaced by copies; this follows them). */
const layerOfCanvas = new WeakMap<HTMLCanvasElement, string>();
/** History-only tile grids. Rendering has its own dirtyBy lifecycle below. */
const historyTiles = new WeakMap<HTMLCanvasElement, RasterHistorySnapshot>();
const historyDirty = new WeakMap<HTMLCanvasElement, Set<string>>();
/** What each layer changed since the last frame that composed it (Paso 3: the retained page reads and clears it). */
const dirtyBy = new Map<string, Dirty>();

function markDirty(layerId: string, d: Dirty): void {
  const cur = dirtyBy.get(layerId);
  if (d === 'all' || cur === 'all') { dirtyBy.set(layerId, 'all'); return; }
  if (!cur) { dirtyBy.set(layerId, d); return; }
  dirtyBy.set(layerId, { x0: Math.min(cur.x0, d.x0), y0: Math.min(cur.y0, d.y0), x1: Math.max(cur.x1, d.x1), y1: Math.max(cur.y1, d.y1) });
}
/** The area a layer changed since the last take, or null when nothing changed. Clears it. */
export function takeDirty(layerId: string): Dirty | null {
  const d = dirtyBy.get(layerId) ?? null;
  dirtyBy.delete(layerId);
  return d;
}

/**
 * Replace a layer's buffer and persist it. A canvas from getRasterSurface or cloneCanvas is stored as it is; a full
 * buffer is cropped to its pixels. `dirty` says where the write landed, in full-buffer pixels (default: everywhere).
 */
export function setBuffer(layerId: string, canvas: HTMLCanvasElement, persist = true, dirty: Dirty = 'all'): void {
  storeCanvas(layerId, isPlaced(canvas) ? canvas : cropToContent(canvas), persist, dirty);
}

function storeCanvas(layerId: string, canvas: HTMLCanvasElement, persist: boolean, dirty: Dirty): void {
  const previous = buffers.get(layerId);
  const same = previous !== undefined && sameBox(previous, canvas);
  const previousTiles = same && previous !== canvas ? historyTiles.get(previous) : undefined;
  buffers.set(layerId, canvas);
  layerOfCanvas.set(canvas, layerId);
  if (dirty === 'all' || !same) {
    historyTiles.delete(canvas);
    historyDirty.delete(canvas);
  } else {
    if (previousTiles) historyTiles.set(canvas, previousTiles);
    markHistoryDirty(canvas, dirty.x0, dirty.y0, dirty.x1 - dirty.x0, dirty.y1 - dirty.y0);
  }
  markDirty(layerId, dirty);
  touchBuffer(canvas);
  if (persist) schedulePersist(layerId);
  notify();
}

export function restoreBuffers(map: Map<string, HTMLCanvasElement>): void {
  const end = span('raster', 'restore', { buffers: map.size, copiedPixels: 0 });
  for (const [id, c] of map) {
    buffers.set(id, c);
    layerOfCanvas.set(c, id);
    historyTiles.delete(c);
    historyDirty.delete(c);
    touchBuffer(c);
    schedulePersist(id);
  }
  notify();
  end();
}

/** History-only snapshots; the legacy snapshotBuffers API continues to return the original canvas refs. */
export function snapshotHistoryBuffers(layerIds: string[]): Map<string, RasterHistorySnapshot> {
  const out = new Map<string, RasterHistorySnapshot>();
  for (const id of layerIds) {
    const canvas = buffers.get(id);
    if (!canvas) continue;
    flushHistoryTiles(canvas);
    let snapshot = historyTiles.get(canvas);
    if (!snapshot) {
      snapshot = snapshotRasterTiles(canvas, RASTER_HISTORY_TILE_SIZE, geometryOf(canvas));
      historyTiles.set(canvas, snapshot);
    }
    out.set(id, snapshot);
  }
  return out;
}

export function restoreHistoryBuffers(map: Map<string, RasterHistorySnapshot>): void {
  const canvases = new Map<string, HTMLCanvasElement>();
  for (const [id, snapshot] of map) {
    const canvas = restoreRasterTiles(snapshot);
    if (snapshot.geometry) place(canvas, snapshot.geometry);
    canvases.set(id, canvas);
  }
  restoreBuffers(canvases);
  for (const [id, canvas] of canvases) historyTiles.set(canvas, map.get(id)!);
}

/** A rectangle in full-buffer pixels, marked in the canvas's own tile grid. */
function markHistoryDirty(canvas: HTMLCanvasElement, x: number, y: number, width: number, height: number): void {
  const g = geometryOf(canvas);
  const bx = Math.max(0, x - g.x0), by = Math.max(0, y - g.y0);
  const x1 = Math.min(canvas.width, x + width - g.x0), y1 = Math.min(canvas.height, y + height - g.y0);
  if (x1 <= bx || y1 <= by) return;
  let keys = historyDirty.get(canvas);
  if (!keys) { keys = new Set(); historyDirty.set(canvas, keys); }
  for (const key of tileKeysForRect(bx, by, x1 - bx, y1 - by, RASTER_HISTORY_TILE_SIZE)) keys.add(key);
}

function flushHistoryTiles(canvas: HTMLCanvasElement): void {
  const changed = historyDirty.get(canvas);
  if (!changed?.size) return;
  const previous = historyTiles.get(canvas);
  if (previous) historyTiles.set(canvas, updateRasterTiles(previous, canvas, changed));
  changed.clear();
}

/** A copy of a canvas, placed where the original sits. */
export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const end = span('raster', 'clone', { pixels: src.width * src.height });
  const c = createCanvas(src.width, src.height);
  if (src.width && src.height) ctx2d(c).drawImage(src, 0, 0);
  place(c, geometryOf(src));
  end();
  return c;
}

/** Keep the pre-existing flattened pixels as the immutable foundation for editable strokes. */
export function withPaintBase(layer: RasterLayer): RasterLayer {
  if (layer.paintBaseId) return layer;
  const paintBaseId = uid('rbase');
  setBuffer(paintBaseId, cloneCanvas(buffers.get(layer.id) ?? emptyBox(layer.pxWidth, layer.pxHeight)));
  return { ...layer, paintBaseId, paintStrokes: [] };
}

/**
 * A stroke being painted, as SAI does it: segments go into a mask at full strength (overlaps cannot add up), and
 * the layer is the pixels it had before the stroke with the mask laid over at the brush opacity. Only the area
 * the new segment touches is recomposed, so a long stroke costs the same per move as a short one. base, mask and
 * the working canvas share one place; a stroke that leaves its box grows them together (paintLive).
 */
export interface LiveStroke {
  base: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  color: string;
  opacity: number;
  erase: boolean;
  /** The pixel selection, in full-buffer pixels: paint and erase land only inside it (as GIMP and Krita do). */
  clip?: HTMLCanvasElement | null;
  /** The brush tip (brushEngine.ts); absent = canvas lines, as strokes were painted before the engine. */
  tip?: BrushTip;
  /** The last segment's width and density: the next one starts from them. */
  last?: { width: number; density: number };
  /**
   * The mask's pixels, kept in memory: segments are stamped here and only the touched area is written to the mask
   * canvas, never read back (a canvas read waits for the GPU on every move). Absent for very large layers.
   */
  pixels?: ImageData;
}
// Above this many pixels the live mask is read per segment as before, instead of holding a full copy in memory.
const LIVE_PIXELS_MAX = 16_000_000;
function livePixels(live: LiveStroke): ImageData | undefined {
  if (!live.pixels && typeof ImageData !== 'undefined' && live.mask.width * live.mask.height <= LIVE_PIXELS_MAX) live.pixels = new ImageData(live.mask.width, live.mask.height);
  return live.pixels;
}

// A brush stroke is being painted (from its first segment until its edit is committed): the FX cache may then
// show a filtered result a few frames old instead of filtering again on every move (render.ts).
let liveStroke = false;
export const paintingLive = () => liveStroke;

export function beginLiveStroke(base: HTMLCanvasElement, color: string, opacity: number, erase: boolean, clip?: HTMLCanvasElement | null, tip?: BrushTip): LiveStroke {
  liveStroke = true;
  return { base, mask: place(createCanvas(base.width, base.height), geometryOf(base)), color, opacity, erase, clip, tip };
}

/**
 * Make the working canvas, its base and the mask cover `need` (full-buffer pixels), growing them together when the
 * stroke leaves the box. Returns the working canvas (the store follows it).
 */
function fitLive(buf: HTMLCanvasElement, live: LiveStroke, need: Region): HTMLCanvasElement {
  const next = growTo(buf, need);
  if (next === buf) return buf;
  const box = regionOf(next)!;
  const oldMask = live.mask, oldPixels = live.pixels;
  live.base = regrid(live.base, box);
  live.mask = regrid(oldMask, box);
  if (oldPixels) {
    const pixels = new ImageData(live.mask.width, live.mask.height);
    const g = geometryOf(oldMask), dx = g.x0 - box.x0, dy = g.y0 - box.y0;
    for (let row = 0; row < oldMask.height; row++) pixels.data.set(oldPixels.data.subarray(row * oldMask.width * 4, (row + 1) * oldMask.width * 4), ((row + dy) * pixels.width + dx) * 4);
    live.pixels = pixels;
  }
  const owner = layerOfCanvas.get(buf);
  if (owner !== undefined && buffers.get(owner) === buf) {
    buffers.set(owner, next);
    layerOfCanvas.set(next, owner);
    touchBuffer(next);
  }
  return next;
}

/** The full-buffer area a segment with `reach` touches: its tip box and the padded box, inside the page. */
function segmentRegion(a: { x: number; y: number }, b: { x: number; y: number }, reach: number, fw: number, fh: number): Region | null {
  const pad = reach / 2 + 2;
  const sb = segmentBox([a.x, a.y, b.x, b.y, reach]);
  const x0 = Math.min(Math.floor(Math.min(a.x, b.x) - pad), sb.x), y0 = Math.min(Math.floor(Math.min(a.y, b.y) - pad), sb.y);
  const x1 = Math.max(Math.ceil(Math.max(a.x, b.x) + pad), sb.x + sb.w), y1 = Math.max(Math.ceil(Math.max(a.y, b.y) + pad), sb.y + sb.h);
  const r = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(fw, x1), y1: Math.min(fh, y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

export function paintLive(buf0: HTMLCanvasElement, live: LiveStroke, a: { x: number; y: number }, b: { x: number; y: number }, width: number, density = 1): HTMLCanvasElement {
  touchBuffer(buf0);
  const owner = layerOfCanvas.get(buf0);
  // A segment starts at the previous width: its box covers the wider of the two.
  const reach = Math.max(width, live.tip ? live.last?.width ?? 0 : 0);
  if (owner) {
    const r = reach / 2 + 2;
    const d = { x0: Math.min(a.x, b.x) - r, y0: Math.min(a.y, b.y) - r, x1: Math.max(a.x, b.x) + r, y1: Math.max(a.y, b.y) + r };
    markDirty(owner, d);
    const cur = strokeSpan.get(owner);
    const reg = { x0: Math.floor(d.x0), y0: Math.floor(d.y0), x1: Math.ceil(d.x1), y1: Math.ceil(d.y1) };
    strokeSpan.set(owner, cur ? { x0: Math.min(cur.x0, reg.x0), y0: Math.min(cur.y0, reg.y0), x1: Math.max(cur.x1, reg.x1), y1: Math.max(cur.y1, reg.y1) } : reg);
  }
  const end = span('raster', 'live');
  try {
    const g0 = geometryOf(buf0);
    const region = segmentRegion(a, b, reach, g0.fw, g0.fh);
    if (!region) return buf0;
    const buf = fitLive(buf0, live, region);
    const g = geometryOf(buf);
    const A = { x: a.x - g.x0, y: a.y - g.y0 }, B = { x: b.x - g.x0, y: b.y - g.y0 };
    if (live.tip) {
      // The tip engine: the segment's coverage goes into the mask where it is stronger than what is there.
      const box = segmentBox([A.x, A.y, B.x, B.y, reach]);
      const x = Math.max(0, box.x), y = Math.max(0, box.y), w = Math.min(buf.width, box.x + box.w) - x, h = Math.min(buf.height, box.y + box.h) - y;
      if (w > 0 && h > 0) {
        const m = ctx2d(live.mask), all = livePixels(live);
        if (all) {
          stampSegment(all, 0, 0, [A.x, A.y, B.x, B.y, width], density, live.tip, hexRgb(live.color), live.last);
          m.putImageData(all, 0, 0, x, y, w, h);
        } else {
          const img = m.getImageData(x, y, w, h);
          stampSegment(img, x, y, [A.x, A.y, B.x, B.y, width], density, live.tip, hexRgb(live.color), live.last);
          m.putImageData(img, x, y);
        }
        live.last = { width, density };
      }
    } else strokeSegment(ctx2d(live.mask), A, B, { width, color: live.color, opacity: 1, erase: false });
    const pad = reach / 2 + 2;
    const x = Math.max(0, Math.floor(Math.min(A.x, B.x) - pad)), y = Math.max(0, Math.floor(Math.min(A.y, B.y) - pad));
    const x1 = Math.min(buf.width, Math.ceil(Math.max(A.x, B.x) + pad)), y1 = Math.min(buf.height, Math.ceil(Math.max(A.y, B.y) + pad));
    const w = x1 - x, h = y1 - y;
    if (w <= 0 || h <= 0) return buf;
    markHistoryDirty(buf, x + g.x0, y + g.y0, w, h);
    if (live.clip) {
      // Keep the stroke only where the selection is (soft edges stay soft).
      const m = ctx2d(live.mask);
      m.save();
      m.globalCompositeOperation = 'destination-in';
      m.drawImage(live.clip, x + g.x0, y + g.y0, w, h, x, y, w, h);
      m.restore();
    }
    const ctx = ctx2d(buf), bg = geometryOf(live.base);
    ctx.save();
    ctx.clearRect(x, y, w, h);
    ctx.drawImage(live.base, x + g.x0 - bg.x0, y + g.y0 - bg.y0, w, h, x, y, w, h);
    ctx.restore();
    layMask(ctx, live.mask, x, y, x, y, w, h, live.tip, live.opacity, live.erase, live.base, bg.x0 - g.x0, bg.y0 - g.y0);
    return buf;
  } finally { end(); }
}

/**
 * Paint again the part of the live stroke that `changed` covered (their old extent), from all of `segments`: what
 * the end taper needs, since a mask that keeps the strongest coverage cannot shrink in place.
 */
export function repaintLive(buf0: HTMLCanvasElement, live: LiveStroke, changed: readonly (readonly number[])[], segments: readonly (readonly number[])[], densities?: readonly number[]): HTMLCanvasElement {
  if (!live.tip || !changed.length) return buf0;
  touchBuffer(buf0);
  const boxes = changed.map(segmentBox);
  const g0 = geometryOf(buf0);
  const rx0 = Math.max(0, Math.min(...boxes.map((b) => b.x))), ry0 = Math.max(0, Math.min(...boxes.map((b) => b.y)));
  const rx1 = Math.min(g0.fw, Math.max(...boxes.map((b) => b.x + b.w))), ry1 = Math.min(g0.fh, Math.max(...boxes.map((b) => b.y + b.h)));
  if (rx1 <= rx0 || ry1 <= ry0) return buf0;
  const buf = fitLive(buf0, live, { x0: rx0, y0: ry0, x1: rx1, y1: ry1 });
  const g = geometryOf(buf), bg = geometryOf(live.base);
  const x = rx0 - g.x0, y = ry0 - g.y0, w = rx1 - rx0, h = ry1 - ry0;
  markHistoryDirty(buf, rx0, ry0, w, h);
  const m = ctx2d(live.mask), rgb = hexRgb(live.color), img = m.createImageData(w, h);
  const local = (seg: readonly number[]) => [seg[0] - g.x0, seg[1] - g.y0, seg[2] - g.x0, seg[3] - g.y0, seg[4]];
  segments.forEach((seg, i) => {
    const s = local(seg), b = segmentBox(s);
    if (b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y) stampSegment(img, x, y, s, densities?.[i] ?? 1, live.tip!, rgb, i ? { width: segments[i - 1][4], density: densities?.[i - 1] ?? 1 } : undefined);
  });
  m.putImageData(img, x, y);
  // The in-memory copy follows, so a later segment never writes back the tail as it was before the taper.
  const all = live.pixels;
  if (all) for (let row = 0; row < h; row++) all.data.set(img.data.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * all.width + x) * 4);
  if (live.clip) {
    m.save();
    m.globalCompositeOperation = 'destination-in';
    m.drawImage(live.clip, rx0, ry0, w, h, x, y, w, h);
    m.restore();
  }
  const ctx = ctx2d(buf);
  ctx.clearRect(x, y, w, h);
  ctx.drawImage(live.base, x + g.x0 - bg.x0, y + g.y0 - bg.y0, w, h, x, y, w, h);
  layMask(ctx, live.mask, x, y, x, y, w, h, live.tip, live.opacity, live.erase, live.base, bg.x0 - g.x0, bg.y0 - g.y0);
  return buf;
}

function pixelLayers(layers: Layer[]): RasterLayer[] {
  return layers.flatMap(l => l.type === 'raster' ? [l] : l.type === 'vector' && l.pixelMask ? [l.pixelMask] : []);
}

export function rasterBufferIds(layers: Layer[]): string[] {
  const rasters = pixelLayers(layers);
  return [...new Set(rasters.flatMap((l) => l.paintBaseId ? [l.id, l.paintBaseId] : [l.id]))];
}

/** Start an edit: clone the current buffer so earlier snapshots stay intact. */
export function beginEdit(layer: RasterLayer): HTMLCanvasElement {
  const current = buffers.get(layer.id) ?? emptyBox(layer.pxWidth, layer.pxHeight);
  flushHistoryTiles(current);
  const copy = cloneCanvas(current);
  buffers.set(layer.id, copy);
  layerOfCanvas.set(copy, layer.id);
  strokeSpan.delete(layer.id);
  carryLayerBox(layer.id, current, copy);
  const shared = historyTiles.get(current);
  if (shared) historyTiles.set(copy, shared);
  return copy;
}

export function commitEdit(layerId: string): void {
  liveStroke = false;
  const current = buffers.get(layerId);
  const span = strokeSpan.get(layerId);
  strokeSpan.delete(layerId);
  if (current) flushHistoryTiles(current);
  touchBuffer(current);
  // The layer's box is known without reading the canvas back: the box before the stroke plus the stroke's region.
  if (current && span) extendLayerBox(layerId, current, span, bufferVersion(layerId), geometryOf(current));
  schedulePersist(layerId);
  notify();
}

/** Redraw the views once, `ms` from now, without changing any pixels' version (the FX cache catching up). */
let redrawTimer: ReturnType<typeof setTimeout> | undefined;
let redrawDue = Infinity;
export function redrawSoon(ms: number): void {
  // Several callers may ask: the earliest one wins (one redraw serves them all).
  const due = Date.now() + Math.max(0, ms);
  if (redrawTimer !== undefined && redrawDue <= due) return;
  clearTimeout(redrawTimer);
  redrawDue = due;
  redrawTimer = setTimeout(() => { redrawTimer = undefined; redrawDue = Infinity; notify(); }, Math.max(0, ms));
}

export function touchRaster(): void {
  // Which buffer changed is unknown: every content version moves on.
  for (const c of buffers.values()) touchBuffer(c);
  notify();
}

/*
 * Saving: each edited layer is written 700 ms after its last change. A layer stays pending (waiting, writing or
 * failed) until its latest pixels are stored; writes of one layer run in order, so an older one never lands after
 * a newer one. Hiding or closing the tab writes everything pending at once, and closing with unsaved pixels asks
 * first. A failed write stays pending, is retried with the next change or flush, and is reported once.
 * Limit: a process killed before a write finishes can still lose the last stroke.
 * The file is the full buffer, assembled from the box, so its bytes do not depend on the box.
 */
const PERSIST_DELAY_MS = 700;
/** Idle first: a layer's PNG waits for a quiet moment, at most this long (the state save uses the same bound). */
const PERSIST_IDLE_TIMEOUT_MS = 1000;
const timers = new Map<string, number>();
const idles = new Map<string, number>();
const pending = new Set<string>();
const chains = new Map<string, Promise<void>>();
let failureReported = false;

/** One scheduled write per layer: a newer change replaces the waiting one, so several strokes share one write. */
function cancelScheduled(layerId: string): void {
  const t = timers.get(layerId);
  if (t !== undefined) { window.clearTimeout(t); timers.delete(layerId); }
  const h = idles.get(layerId);
  if (h !== undefined) { window.cancelIdleCallback?.(h); idles.delete(layerId); }
}

function schedulePersist(layerId: string): void {
  if (unreadable.has(layerId)) return;
  pending.add(layerId);
  rasterPending(layerId);
  cancelScheduled(layerId);
  if (typeof window.requestIdleCallback !== 'function') {
    timers.set(layerId, window.setTimeout(() => void writeLayer(layerId), PERSIST_DELAY_MS));
    return;
  }
  idles.set(layerId, window.requestIdleCallback(() => {
    idles.delete(layerId);
    // Still painting: the stroke's own commit schedules the write again, so wait for the next idle time.
    if (paintingLive()) { schedulePersist(layerId); return; }
    void writeLayer(layerId);
  }, { timeout: PERSIST_IDLE_TIMEOUT_MS }));
}

function writeLayer(layerId: string): Promise<void> {
  cancelScheduled(layerId);
  const run = (chains.get(layerId) ?? Promise.resolve()).then(async () => {
    const c = buffers.get(layerId);
    if (!c) {
      pending.delete(layerId);
      rasterSaved(layerId);
      return;
    }
    const revision = bufferVersion(layerId);
    try {
      await blobDb.set(keyFor(layerId), await canvasToBlob(assembleFull(c), 'image/png'));
      // Live strokes mutate this same canvas in place; reference equality alone cannot acknowledge an old snapshot.
      if (buffers.get(layerId) === c && bufferVersion(layerId) === revision && !timers.has(layerId) && !idles.has(layerId)) { pending.delete(layerId); rasterSaved(layerId); }
      failureReported = false;
      localFailed.delete(layerId);
    } catch (err) {
      // Not even the browser copy was written (quota, broken IndexedDB): those pixels are only in memory.
      if ((err as { diskOnly?: boolean } | null)?.diskOnly) localFailed.delete(layerId); // idb.ts DiskPendingError
      else localFailed.add(layerId);
      failSave('Layer pixels pending', err instanceof Error && err.message.includes('Another tab'));
      if (!failureReported) {
        failureReported = true;
        toast('Could not save layer pixels to storage. They are kept in memory and saving will be retried; do not close this tab yet.', 'error');
      }
    }
  });
  chains.set(layerId, run);
  return run;
}

/**
 * Write every pending layer now (tab hidden or closing, or before an action that needs them stored). Rejects when a
 * layer could not be written even to the browser (a handover of the writer lock stops on it); a disk failure does not.
 */
export function flushRaster(): Promise<void> {
  return Promise.all([...pending].map((id) => writeLayer(id))).then(() => {
    if (localFailed.size) throw new Error('Could not save layer pixels to browser storage');
  });
}

/** Layers whose last write failed in the browser itself, not only on disk. */
const localFailed = new Set<string>();

/** Layers whose latest pixels are not stored yet. */
export function pendingRaster(): string[] {
  return [...pending];
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushRaster().catch(() => undefined));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushRaster().catch(() => undefined);
  });
}

/** D30: layers whose stored pixels failed to read or decode; never written until a load succeeds. */
const unreadable = new Set<string>();

/** Load buffers for layers that are not in memory yet (after reload). A stored full buffer is cropped to its box. */
export async function ensureBuffers(allLayers: Layer[]): Promise<void> {
  const layers = pixelLayers(allLayers);
  let changed = false;
  const baseIds = new Set(layers.map((l) => l.paintBaseId).filter(Boolean));
  await Promise.all(
    layers.flatMap((l) => l.paintBaseId ? [l, { ...l, id: l.paintBaseId, paintBaseId: undefined }] : [l]).map(async (l) => {
      if (buffers.has(l.id) && !unreadable.has(l.id)) return;
      let failed = false;
      const fail = (what: string) => (e: unknown) => { failed = true; logged(what)(e); return null; };
      const blob = await blobDb.get(keyFor(l.id)).catch(fail('read layer pixels'));
      const full = blob ? await blobToCanvas(blob).catch(fail('decode layer pixels')) : null;
      // D30: stored pixels that could not be read are not an empty layer. No blank buffer, no write over them; the
      // next load tries again. Nothing stored at all is a new, empty layer.
      if (failed) {
        if (!unreadable.has(l.id)) toast(`The pixels of a layer could not be read. It is kept as it is on disk and not saved over; reopen the design to try again.`, 'error');
        unreadable.add(l.id);
        return;
      }
      // A missing foundation must never be replaced by blank pixels when objects are moved.
      if (!full && baseIds.has(l.id)) return;
      // Recovered: the real pixels replace whatever was drawn on the blank stand-in (it was never saved).
      const recovered = unreadable.delete(l.id);
      if (buffers.has(l.id) && !recovered) return;
      buffers.set(l.id, full ? cropToContent(full) : emptyBox(l.pxWidth, l.pxHeight));
      changed = true;
    }),
  );
  if (changed) notify();
}

/**
 * D19: free from memory the pixels of layers that were in a document and are in none now (deleted, merged). Undo keeps
 * its own tile copies (snapshotHistoryBuffers) and the disk copy stays, so a layer brought back loads again
 * (ensureBuffers). Never a layer waiting to be written, failed, or mid-stroke; never one not yet seen in a document.
 */
const seenLive = new Set<string>();
export function releaseBuffers(liveIds: Iterable<string>, wereLive: Iterable<string> = []): number {
  for (const id of wereLive) seenLive.add(id);
  const live = new Set(liveIds);
  let freed = 0;
  for (const id of [...buffers.keys()]) {
    if (live.has(id)) { seenLive.add(id); continue; }
    if (!seenLive.has(id) || pending.has(id) || timers.has(id) || idles.has(id) || localFailed.has(id) || strokeSpan.has(id)) continue;
    buffers.delete(id);
    seenLive.delete(id);
    freed++;
  }
  if (freed) notify();
  return freed;
}

export async function deleteBuffers(layerIds: string[]): Promise<void> {
  for (const id of layerIds) {
    buffers.delete(id);
    const t = timers.get(id);
    if (t) window.clearTimeout(t);
    timers.delete(id);
    pending.delete(id);
    rasterSaved(id);
  }
  // Let writes already running finish first, so they cannot bring a deleted layer's pixels back.
  await Promise.all(layerIds.map((id) => chains.get(id)));
  // After those writes: a deleted layer that failed in the browser no longer blocks flushRaster (and a handover).
  layerIds.forEach((id) => { chains.delete(id); localFailed.delete(id); });
  if (layerIds.length) await blobDb.delMany(layerIds.map(keyFor)).catch(() => undefined);
  notify();
}

/** Copy a buffer to a new layer id (duplicate layer). */
export function copyBuffer(fromId: string, toId: string): void {
  const src = buffers.get(fromId);
  if (!src) return;
  setBuffer(toId, cloneCanvas(src));
}
