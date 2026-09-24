import { blobDb } from '../../lib/idb';
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d } from '../../lib/media';
import type { RasterLayer } from '../types';

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

const timers = new Map<string, number>();

function schedulePersist(layerId: string): void {
  const t = timers.get(layerId);
  if (t) window.clearTimeout(t);
  timers.set(
    layerId,
    window.setTimeout(() => {
      timers.delete(layerId);
      const c = buffers.get(layerId);
      if (!c) return;
      canvasToBlob(c, 'image/png')
        .then((blob) => blobDb.set(keyFor(layerId), blob))
        .catch(() => undefined);
    }, 700),
  );
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
  }
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
