import { rasterPending, rasterSaved, failSave } from '../../store/saveStatus';
import { rasterStrokeMask } from './rasterStrokeMask';
import { span } from '../../lib/trace';
import { logged } from '../../lib/log';
import { blobDb } from '../../lib/idb';
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d } from '../../lib/media';
import { uid } from '../../lib/id';
import type { Layer, RasterLayer, RasterStroke } from '../types';
import { toast } from '../../store/store';
import { compositeOp, hexRgb, segmentBox, stampSegment, type BrushTip } from './brushEngine';
import { RASTER_HISTORY_TILE_SIZE, restoreRasterTiles, snapshotRasterTiles, tileKeysForRect, updateRasterTiles, type RasterHistorySnapshot } from './rasterHistoryTiles';

/*
 * Pixel buffers of raster layers. Buffers are treated as immutable snapshots:
 * any edit clones the current canvas first (copy-on-write), which keeps undo cheap.
 */

const buffers = new Map<string, HTMLCanvasElement>();
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

export function getBuffer(layerId: string): HTMLCanvasElement | undefined {
  return buffers.get(layerId);
}

export function snapshotBuffers(layerIds: string[]): Map<string, HTMLCanvasElement> {
  const out = new Map<string, HTMLCanvasElement>();
  for (const id of layerIds) {
    const b = buffers.get(id);
    if (b) out.set(id, b);
  }
  return out;
}

/** A dirty area in buffer pixels, or 'all' when the write does not say where it landed. */
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

/** Replace a layer's buffer (no copy) and persist it. `dirty` says where the write landed (default: everywhere). */
export function setBuffer(layerId: string, canvas: HTMLCanvasElement, persist = true, dirty: Dirty = 'all'): void {
  const previous = buffers.get(layerId);
  const previousTiles = previous && previous.width === canvas.width && previous.height === canvas.height ? historyTiles.get(previous) : undefined;
  buffers.set(layerId, canvas);
  layerOfCanvas.set(canvas, layerId);
  if (dirty === 'all' || (previous && (previous.width !== canvas.width || previous.height !== canvas.height))) {
    historyTiles.delete(canvas);
    historyDirty.delete(canvas);
  } else {
    if (previous !== canvas && previousTiles) historyTiles.set(canvas, previousTiles);
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
      snapshot = snapshotRasterTiles(canvas);
      historyTiles.set(canvas, snapshot);
    }
    out.set(id, snapshot);
  }
  return out;
}

export function restoreHistoryBuffers(map: Map<string, RasterHistorySnapshot>): void {
  const canvases = new Map<string, HTMLCanvasElement>();
  for (const [id, snapshot] of map) canvases.set(id, restoreRasterTiles(snapshot));
  restoreBuffers(canvases);
  for (const [id, canvas] of canvases) historyTiles.set(canvas, map.get(id)!);
}

function markHistoryDirty(canvas: HTMLCanvasElement, x: number, y: number, width: number, height: number): void {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(canvas.width, x + width), y1 = Math.min(canvas.height, y + height);
  if (x1 <= x0 || y1 <= y0) return;
  let keys = historyDirty.get(canvas);
  if (!keys) { keys = new Set(); historyDirty.set(canvas, keys); }
  for (const key of tileKeysForRect(x0, y0, x1 - x0, y1 - y0, RASTER_HISTORY_TILE_SIZE)) keys.add(key);
}

function flushHistoryTiles(canvas: HTMLCanvasElement): void {
  const changed = historyDirty.get(canvas);
  if (!changed?.size) return;
  const previous = historyTiles.get(canvas);
  if (previous) historyTiles.set(canvas, updateRasterTiles(previous, canvas, changed));
  changed.clear();
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const end = span('raster', 'clone', { pixels: src.width * src.height });
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  end();
  return c;
}

/** Keep the pre-existing flattened pixels as the immutable foundation for editable strokes. */
export function withPaintBase(layer: RasterLayer): RasterLayer {
  if (layer.paintBaseId) return layer;
  const paintBaseId = uid('rbase');
  setBuffer(paintBaseId, cloneCanvas(getBuffer(layer.id) ?? createCanvas(layer.pxWidth, layer.pxHeight)));
  return { ...layer, paintBaseId, paintStrokes: [] };
}

/**
 * Replay a saved stroke. Contiguous segments of the same width are one path, stroked once: with an opacity below
 * 100 % the overlapping round ends of separate segments would add up into beads along the line.
 */
export function drawRasterStroke(ctx: CanvasRenderingContext2D, stroke: RasterStroke): void {
  if (stroke.tip) return drawTipStroke(ctx, stroke, stroke.tip);
  const segs = stroke.segments;
  let i = 0;
  while (i < segs.length) {
    const width = segs[i][4];
    ctx.save();
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    ctx.globalAlpha = stroke.opacity;
    ctx.strokeStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(segs[i][0] + stroke.x, segs[i][1] + stroke.y);
    let j = i;
    for (; j < segs.length && segs[j][4] === width && (j === i || (segs[j][0] === segs[j - 1][2] && segs[j][1] === segs[j - 1][3])); j++) {
      // A tiny offset so a click without movement still leaves a dot.
      ctx.lineTo(segs[j][2] + stroke.x + (j === i ? 0.01 : 0), segs[j][3] + stroke.y);
    }
    ctx.stroke();
    ctx.restore();
    i = j;
  }
}

/** A stroke with a brush tip (brushEngine.ts): its mask built the same way as while it was painted, laid once. */
function drawTipStroke(ctx: CanvasRenderingContext2D, stroke: RasterStroke, tip: BrushTip): void {
  if (!stroke.segments.length) return;
  const { canvas: mask, x, y } = rasterStrokeMask(stroke, tip);
  layMask(ctx, mask, 0, 0, x + stroke.x, y + stroke.y, mask.width, mask.height, tip, stroke.opacity, stroke.erase);
}

/**
 * The mask laid on the layer region (dx, dy, w, h) from (sx, sy) in the mask: at the stroke's opacity, with its blend;
 * Keep Opacity then keeps the layer's alpha as it was before the stroke.
 */
function layMask(ctx: CanvasRenderingContext2D, mask: HTMLCanvasElement, sx: number, sy: number, dx: number, dy: number, w: number, h: number, tip: BrushTip | undefined, opacity: number, erase: boolean, before?: HTMLCanvasElement): void {
  const keep = tip?.keepOpacity && !erase;
  // The pixels under the stroke before it lands, for Keep Opacity (the live stroke passes its base).
  let base = before, bx = dx, by = dy;
  if (keep && !base) {
    base = createCanvas(w, h);
    ctx2d(base).drawImage(ctx.canvas, dx, dy, w, h, 0, 0, w, h);
    bx = 0; by = 0;
  }
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = compositeOp(tip, erase);
  ctx.drawImage(mask, sx, sy, w, h, dx, dy, w, h);
  if (keep && base) {
    // destination-in clears outside what it draws: kept to the stroke's region.
    ctx.beginPath();
    ctx.rect(dx, dy, w, h);
    ctx.clip();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(base, bx, by, w, h, dx, dy, w, h);
  }
  ctx.restore();
}

/**
 * A stroke being painted, as SAI does it: segments go into a mask at full strength (overlaps cannot add up), and
 * the layer is the pixels it had before the stroke with the mask laid over at the brush opacity. Only the area
 * the new segment touches is recomposed, so a long stroke costs the same per move as a short one.
 */
export interface LiveStroke {
  base: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  color: string;
  opacity: number;
  erase: boolean;
  /** The pixel selection in this layer's pixels: paint and erase land only inside it (as GIMP and Krita do). */
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
  return { base, mask: createCanvas(base.width, base.height), color, opacity, erase, clip, tip };
}

export function paintLive(buf: HTMLCanvasElement, live: LiveStroke, a: { x: number; y: number }, b: { x: number; y: number }, width: number, density = 1): void {
  touchBuffer(buf);
  const owner = layerOfCanvas.get(buf);
  if (owner) { const r = Math.max(width, live.tip ? live.last?.width ?? 0 : 0) / 2 + 2; markDirty(owner, { x0: Math.min(a.x, b.x) - r, y0: Math.min(a.y, b.y) - r, x1: Math.max(a.x, b.x) + r, y1: Math.max(a.y, b.y) + r }); }
  const end = span('raster', 'live');
  try {
  // A segment starts at the previous width: its box covers the wider of the two.
  const reach = Math.max(width, live.tip ? live.last?.width ?? 0 : 0);
  if (live.tip) {
    // The tip engine: the segment's coverage goes into the mask where it is stronger than what is there.
    const box = segmentBox([a.x, a.y, b.x, b.y, reach]);
    const x = Math.max(0, box.x), y = Math.max(0, box.y), w = Math.min(buf.width, box.x + box.w) - x, h = Math.min(buf.height, box.y + box.h) - y;
    if (w > 0 && h > 0) {
      const m = ctx2d(live.mask), all = livePixels(live);
      if (all) {
        stampSegment(all, 0, 0, [a.x, a.y, b.x, b.y, width], density, live.tip, hexRgb(live.color), live.last);
        m.putImageData(all, 0, 0, x, y, w, h);
      } else {
        const img = m.getImageData(x, y, w, h);
        stampSegment(img, x, y, [a.x, a.y, b.x, b.y, width], density, live.tip, hexRgb(live.color), live.last);
        m.putImageData(img, x, y);
      }
      live.last = { width, density };
    }
  } else strokeSegment(ctx2d(live.mask), a, b, { width, color: live.color, opacity: 1, erase: false });
  const pad = reach / 2 + 2;
  const x = Math.max(0, Math.floor(Math.min(a.x, b.x) - pad)), y = Math.max(0, Math.floor(Math.min(a.y, b.y) - pad));
  const x1 = Math.min(buf.width, Math.ceil(Math.max(a.x, b.x) + pad)), y1 = Math.min(buf.height, Math.ceil(Math.max(a.y, b.y) + pad));
  const w = x1 - x, h = y1 - y;
  if (w <= 0 || h <= 0) return;
  markHistoryDirty(buf, x, y, w, h);
  if (live.clip) {
    // Keep the stroke only where the selection is (soft edges stay soft).
    const m = ctx2d(live.mask);
    m.save();
    m.globalCompositeOperation = 'destination-in';
    m.drawImage(live.clip, x, y, w, h, x, y, w, h);
    m.restore();
  }
  const ctx = ctx2d(buf);
  ctx.save();
  ctx.clearRect(x, y, w, h);
  ctx.drawImage(live.base, x, y, w, h, x, y, w, h);
  ctx.restore();
  layMask(ctx, live.mask, x, y, x, y, w, h, live.tip, live.opacity, live.erase, live.base);
  } finally { end(); }
}

/**
 * Paint again the part of the live stroke that `changed` covered (their old extent), from all of `segments`: what
 * the end taper needs, since a mask that keeps the strongest coverage cannot shrink in place.
 */
export function repaintLive(buf: HTMLCanvasElement, live: LiveStroke, changed: readonly (readonly number[])[], segments: readonly (readonly number[])[], densities?: readonly number[]): void {
  if (!live.tip || !changed.length) return;
  touchBuffer(buf);
  const boxes = changed.map(segmentBox);
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x))), y = Math.max(0, Math.min(...boxes.map((b) => b.y)));
  const w = Math.min(buf.width, Math.max(...boxes.map((b) => b.x + b.w))) - x, h = Math.min(buf.height, Math.max(...boxes.map((b) => b.y + b.h))) - y;
  if (w <= 0 || h <= 0) return;
  markHistoryDirty(buf, x, y, w, h);
  const m = ctx2d(live.mask), rgb = hexRgb(live.color), img = m.createImageData(w, h);
  segments.forEach((seg, i) => {
    const b = segmentBox(seg);
    if (b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y) stampSegment(img, x, y, seg, densities?.[i] ?? 1, live.tip!, rgb, i ? { width: segments[i - 1][4], density: densities?.[i - 1] ?? 1 } : undefined);
  });
  m.putImageData(img, x, y);
  // The in-memory copy follows, so a later segment never writes back the tail as it was before the taper.
  const all = live.pixels;
  if (all) for (let row = 0; row < h; row++) all.data.set(img.data.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * all.width + x) * 4);
  if (live.clip) {
    m.save();
    m.globalCompositeOperation = 'destination-in';
    m.drawImage(live.clip, x, y, w, h, x, y, w, h);
    m.restore();
  }
  const ctx = ctx2d(buf);
  ctx.clearRect(x, y, w, h);
  ctx.drawImage(live.base, x, y, w, h, x, y, w, h);
  layMask(ctx, live.mask, x, y, x, y, w, h, live.tip, live.opacity, live.erase, live.base);
}

/** Rebuild only after moving an object; ordinary painting keeps its incremental renderer. */
export function composeRaster(layer: RasterLayer, persist = true, dirty: Dirty = 'all'): boolean {
  const base = layer.paintBaseId && getBuffer(layer.paintBaseId);
  if (!base) return false;
  const end = span('raster', 'compose', { strokes: layer.paintStrokes?.length ?? 0, pixels: base.width * base.height });
  const canvas = cloneCanvas(base);
  const ctx = ctx2d(canvas);
  for (const stroke of layer.paintStrokes ?? []) drawRasterStroke(ctx, stroke);
  setBuffer(layer.id, canvas, persist, dirty);
  end();
  return true;
}

/**
 * Moving some strokes of a painted layer: composeRaster for every frame of the drag, without its cost. What lies under
 * the first moving stroke (the base and the strokes before it) is drawn once; each frame copies it into one reused
 * canvas and draws only the strokes from there on, in the same order, so the pixels are the same. The layer's buffer
 * before the drag is never written (undo keeps it). Null while the base is not loaded.
 */
export function composeMoving(layer: RasterLayer, ids: readonly string[]): ((moved: RasterLayer) => void) | null {
  const base = layer.paintBaseId && getBuffer(layer.paintBaseId);
  if (!base) return null;
  const moving = new Set(ids);
  const strokes = layer.paintStrokes ?? [];
  const first = Math.max(0, strokes.findIndex((s) => moving.has(s.id)));
  const under = cloneCanvas(base);
  for (const stroke of strokes.slice(0, first)) drawRasterStroke(ctx2d(under), stroke);
  const work = createCanvas(base.width, base.height);
  return (moved) => {
    const end = span('raster', 'compose', { strokes: (moved.paintStrokes?.length ?? 0) - first, pixels: base.width * base.height });
    const ctx = ctx2d(work);
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(under, 0, 0);
    ctx.restore();
    for (const stroke of (moved.paintStrokes ?? []).slice(first)) drawRasterStroke(ctx, stroke);
    // What changed: the moving strokes, where they were and where they are now.
    const before = strokes.filter((x) => moving.has(x.id)).map(strokeBufferBox);
    const after = (moved.paintStrokes ?? []).filter((x) => moving.has(x.id)).map(strokeBufferBox);
    setBuffer(layer.id, work, false, unionOf([...before, ...after]));
    end();
  };
}

/** Bounds of a stroke in buffer pixels, its offset included, with its widest reach. */
export function strokeBufferBox(s: RasterStroke): Dirty {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [ax, ay, bx, by, w] of s.segments) {
    const r = w / 2 + 2;
    x0 = Math.min(x0, ax - r, bx - r); y0 = Math.min(y0, ay - r, by - r);
    x1 = Math.max(x1, ax + r, bx + r); y1 = Math.max(y1, ay + r, by + r);
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0: x0 + s.x, y0: y0 + s.y, x1: x1 + s.x, y1: y1 + s.y };
}
function unionOf(list: Dirty[]): Dirty {
  if (list.some((d) => d === 'all')) return 'all';
  const rs = list as Array<Exclude<Dirty, 'all'>>;
  if (!rs.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0: Math.min(...rs.map((r) => r.x0)), y0: Math.min(...rs.map((r) => r.y0)), x1: Math.max(...rs.map((r) => r.x1)), y1: Math.max(...rs.map((r) => r.y1)) };
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
  const current = buffers.get(layer.id) ?? createCanvas(layer.pxWidth, layer.pxHeight);
  flushHistoryTiles(current);
  const copy = cloneCanvas(current);
  buffers.set(layer.id, copy);
  layerOfCanvas.set(copy, layer.id);
  const shared = historyTiles.get(current);
  if (shared) historyTiles.set(copy, shared);
  return copy;
}

export function commitEdit(layerId: string): void {
  liveStroke = false;
  const current = buffers.get(layerId);
  if (current) flushHistoryTiles(current);
  touchBuffer(current);
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
 */
const PERSIST_DELAY_MS = 700;
const timers = new Map<string, number>();
const pending = new Set<string>();
const chains = new Map<string, Promise<void>>();
let failureReported = false;

function schedulePersist(layerId: string): void {
  pending.add(layerId);
  rasterPending(layerId);
  const t = timers.get(layerId);
  if (t) window.clearTimeout(t);
  timers.set(
    layerId,
    window.setTimeout(() => void writeLayer(layerId), PERSIST_DELAY_MS),
  );
}

function writeLayer(layerId: string): Promise<void> {
  const t = timers.get(layerId);
  if (t) window.clearTimeout(t);
  timers.delete(layerId);
  const run = (chains.get(layerId) ?? Promise.resolve()).then(async () => {
    const c = buffers.get(layerId);
    if (!c) {
      pending.delete(layerId);
      rasterSaved(layerId);
      return;
    }
    try {
      await blobDb.set(keyFor(layerId), await canvasToBlob(c, 'image/png'));
      // A change made while writing (new buffer or a new timer) keeps the layer pending.
      if (buffers.get(layerId) === c && !timers.has(layerId)) { pending.delete(layerId); rasterSaved(layerId); }
      failureReported = false;
    } catch (err) {
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

/** Write every pending layer now (tab hidden or closing, or before an action that needs them stored). */
export function flushRaster(): Promise<void> {
  return Promise.all([...pending].map((id) => writeLayer(id))).then(() => undefined);
}

/** Layers whose latest pixels are not stored yet. */
export function pendingRaster(): string[] {
  return [...pending];
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushRaster());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushRaster();
  });
}

/** Load buffers for layers that are not in memory yet (after reload). */
export async function ensureBuffers(allLayers: Layer[]): Promise<void> {
  const layers = pixelLayers(allLayers);
  let changed = false;
  const baseIds = new Set(layers.map((l) => l.paintBaseId).filter(Boolean));
  await Promise.all(
    layers.flatMap((l) => l.paintBaseId ? [l, { ...l, id: l.paintBaseId, paintBaseId: undefined }] : [l]).map(async (l) => {
      if (buffers.has(l.id)) return;
      const blob = await blobDb.get(keyFor(l.id)).catch(logged('read layer pixels'));
      const canvas = blob ? await blobToCanvas(blob).catch((e) => (logged('decode layer pixels')(e), null)) : null;
      // A missing foundation must never be replaced by blank pixels when objects are moved.
      if (!canvas && baseIds.has(l.id)) return;
      if (buffers.has(l.id)) return;
      buffers.set(l.id, canvas ?? createCanvas(l.pxWidth, l.pxHeight));
      changed = true;
    }),
  );
  if (changed) notify();
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
  layerIds.forEach((id) => chains.delete(id));
  if (layerIds.length) await blobDb.delMany(layerIds.map(keyFor)).catch(() => undefined);
  notify();
}

/** Copy a buffer to a new layer id (duplicate layer). */
export function copyBuffer(fromId: string, toId: string): void {
  const src = buffers.get(fromId);
  if (!src) return;
  setBuffer(toId, cloneCanvas(src));
}

/** One brush or eraser segment in canvas pixels (shared by the Designer and the sketch editor). */
export function strokeSegment(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  opts: { width: number; color: string; opacity: number; erase: boolean },
): void {
  ctx.save();
  ctx.globalCompositeOperation = opts.erase ? 'destination-out' : 'source-over';
  ctx.globalAlpha = opts.opacity;
  ctx.strokeStyle = opts.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = opts.width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  // A tiny offset so a click without movement still leaves a dot.
  ctx.lineTo(b.x + 0.01, b.y);
  ctx.stroke();
  ctx.restore();
}
