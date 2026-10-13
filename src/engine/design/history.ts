import { span } from '../../lib/trace';
import type { DesignDoc } from '../types';
import { rasterBufferIds, restoreHistoryBuffers, snapshotHistoryBuffers } from './raster';
import { takeRasterHistoryCopiedPixels, type RasterHistorySnapshot } from './rasterHistoryTiles';
import { getSelection, setSelection, type PixelSelection } from './pixelSelection';
import { useLayerSelection } from './selection';
import { objectPick, setObjectPick, type ObjectPick } from './objectSelection';

/* Undo/redo for Designer documents. Raster pixels are captured by reference (copy-on-write buffers). */

interface Snapshot {
  doc: DesignDoc;
  buffers: Map<string, RasterHistorySnapshot>;
  /** The pixel selection then: undo and redo bring it back, as in GIMP and Krita. */
  sel: PixelSelection | null;
  /** The picked layers and objects then: redo brings back what the change had selected (a duplicate stays picked). */
  layers: string[] | undefined;
  objects: ObjectPick | null;
}

interface Stack {
  past: Snapshot[];
  future: Snapshot[];
}

const LIMIT = 40;
/** Pixel bytes the undo and redo steps may hold (Paso 5). The newest undo step is always kept. */
export const HISTORY_BYTES_DEFAULT = 512 * 1024 * 1024;
let historyByteLimit = HISTORY_BYTES_DEFAULT;
/** Steps dropped per document to stay under the byte limit (the Designer shows this count, discreetly). */
const dropped = new Map<string, number>();
const stacks = new Map<string, Stack>();
const listeners = new Set<() => void>();

function stack(docId: string): Stack {
  let s = stacks.get(docId);
  if (!s) {
    s = { past: [], future: [] };
    stacks.set(docId, s);
  }
  return s;
}

function restorePicks(docId: string, snap: Snapshot): void {
  setSelection(docId, snap.sel);
  useLayerSelection.setState((s) => ({ byDoc: { ...s.byDoc, [docId]: snap.layers ?? [] } }));
  setObjectPick(docId, snap.objects);
}

function capture(doc: DesignDoc): Snapshot {
  const end = span('history', 'capture', { layers: doc.layers.length });
  // Tile copies committed by the preceding edit belong to that edit, not to this capture span.
  takeRasterHistoryCopiedPixels();
  const rasterIds = rasterBufferIds(doc.layers);
  const snap = { doc, buffers: snapshotHistoryBuffers(rasterIds), sel: getSelection(doc.id), layers: useLayerSelection.getState().byDoc[doc.id], objects: objectPick(doc.id) };
  end({ buffers: snap.buffers.size, tiles: [...snap.buffers.values()].reduce((n, grid) => n + grid.tiles.size, 0), copiedPixels: takeRasterHistoryCopiedPixels() });
  return snap;
}

type ByteItem = { width: number; height: number };
type ByteBuffer = ByteItem & { tiles?: ReadonlyMap<unknown, ByteItem> };
type ByteSnapshot = { buffers: ReadonlyMap<string, unknown> };

/** Pixel bytes held by the given steps, counting shared canvases or tile refs once. */
export function bytesOfSnapshots(snaps: ReadonlyArray<ByteSnapshot>): number {
  const seen = new Set<unknown>();
  let total = 0;
  for (const snap of snaps) {
    for (const raw of snap.buffers.values()) {
      const buffer = raw as ByteBuffer;
      const items = buffer.tiles ? [...buffer.tiles.values()] : [buffer];
      for (const item of items) {
        if (seen.has(item)) continue;
        seen.add(item);
        total += item.width * item.height * 4;
      }
    }
  }
  return total;
}

/**
 * Drops the oldest undo steps until the steps hold at most `limit` bytes. The newest undo step is never dropped (the
 * last change can always be undone). Returns how many steps were dropped.
 */
export function trimByBytes<T extends { buffers: ReadonlyMap<string, unknown> }>(past: T[], future: T[], limit: number): number {
  let n = 0;
  while (past.length > 1 && bytesOfSnapshots([...past, ...future]) > limit) {
    past.shift();
    n++;
  }
  return n;
}

/** Sets the byte limit of the undo history (0 keeps only the newest undo step). */
export function setHistoryByteLimit(bytes: number): void {
  historyByteLimit = Math.max(0, bytes);
}

function trimStack(docId: string, s: Stack): void {
  const n = trimByBytes(s.past, s.future, historyByteLimit);
  if (n > 0) dropped.set(docId, (dropped.get(docId) ?? 0) + n);
}

/** Record the state *before* a change. */
export function record(doc: DesignDoc): void {
  const s = stack(doc.id);
  s.past.push(capture(doc));
  if (s.past.length > LIMIT) s.past.shift();
  s.future = [];
  trimStack(doc.id, s);
  listeners.forEach((l) => l());
}

export function undo(current: DesignDoc): DesignDoc | null {
  const s = stack(current.id);
  const prev = s.past.pop();
  if (!prev) return null;
  s.future.push(capture(current));
  restoreHistoryBuffers(prev.buffers);
  restorePicks(current.id, prev);
  listeners.forEach((l) => l());
  return prev.doc;
}

export function redo(current: DesignDoc): DesignDoc | null {
  const s = stack(current.id);
  const next = s.future.pop();
  if (!next) return null;
  s.past.push(capture(current));
  restoreHistoryBuffers(next.buffers);
  restorePicks(current.id, next);
  listeners.forEach((l) => l());
  return next.doc;
}

export function canUndo(docId: string): boolean {
  return (stacks.get(docId)?.past.length ?? 0) > 0;
}

export function canRedo(docId: string): boolean {
  return (stacks.get(docId)?.future.length ?? 0) > 0;
}

export function subscribeHistory(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function dropHistory(docId: string): void {
  stacks.delete(docId);
}

/** Read-only stack sizes for the sandbox state hook. */
export function historyDepth(docId: string): { undo: number; redo: number; dropped: number } {
  return { undo: stacks.get(docId)?.past.length ?? 0, redo: stacks.get(docId)?.future.length ?? 0, dropped: dropped.get(docId) ?? 0 };
}
