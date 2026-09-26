import { blobDb } from '../../lib/idb';
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d } from '../../lib/media';
import type { RasterLayer } from '../types';
import { toast } from '../../store/store';

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

/** Replace a layer's buffer (no copy) and persist it. */
export function setBuffer(layerId: string, canvas: HTMLCanvasElement, persist = true): void {
  buffers.set(layerId, canvas);
  if (persist) schedulePersist(layerId);
  notify();
}

export function restoreBuffers(map: Map<string, HTMLCanvasElement>): void {
  for (const [id, c] of map) {
    buffers.set(id, c);
    schedulePersist(id);
  }
  notify();
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

/** Start an edit: clone the current buffer so earlier snapshots stay intact. */
export function beginEdit(layer: RasterLayer): HTMLCanvasElement {
  const current = buffers.get(layer.id) ?? createCanvas(layer.pxWidth, layer.pxHeight);
  const copy = cloneCanvas(current);
  buffers.set(layer.id, copy);
  return copy;
}

export function commitEdit(layerId: string): void {
  schedulePersist(layerId);
  notify();
}

export function touchRaster(): void {
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
      return;
    }
    try {
      await blobDb.set(keyFor(layerId), await canvasToBlob(c, 'image/png'));
      // A change made while writing (new buffer or a new timer) keeps the layer pending.
      if (buffers.get(layerId) === c && !timers.has(layerId)) pending.delete(layerId);
      failureReported = false;
    } catch {
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
  window.addEventListener('beforeunload', (e) => {
    if (!pending.size) return;
    void flushRaster();
    e.preventDefault();
    e.returnValue = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushRaster();
  });
}

/** Load buffers for layers that are not in memory yet (after reload). */
export async function ensureBuffers(layers: RasterLayer[]): Promise<void> {
  let changed = false;
  await Promise.all(
    layers.map(async (l) => {
      if (buffers.has(l.id)) return;
      const blob = await blobDb.get(keyFor(l.id)).catch(() => undefined);
      const canvas = blob ? await blobToCanvas(blob).catch(() => null) : null;
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
