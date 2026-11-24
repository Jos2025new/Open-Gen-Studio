import { span } from '../../lib/trace';
import type { DesignDoc } from '../types';
import { rasterBufferIds, restoreHistoryBuffers, snapshotHistoryBuffers } from './raster';
import { takeRasterHistoryCopiedPixels, type RasterHistorySnapshot } from './rasterHistoryTiles';
import { getSelection, setSelection, type PixelSelection } from './pixelSelection';
import { useLayerSelection } from './selection';
import { objectPicks, setObjectPicks, type ObjectPick } from './objectSelection';

/* Undo/redo for Designer documents. Raster pixels are captured by reference (copy-on-write buffers). */

interface Snapshot {
  doc: DesignDoc;
  buffers: Map<string, RasterHistorySnapshot>;
  /** The pixel selection then: undo and redo bring it back, as in GIMP and Krita. */
  sel: PixelSelection | null;
  /** The picked layers and objects then: redo brings back what the change had selected (a duplicate stays picked). */
  layers: string[] | undefined;
  objects: ObjectPick[];
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
  setObjectPicks(docId, snap.objects);
}

function capture(doc: DesignDoc): Snapshot {
  const end = span('history', 'capture', { layers: doc.layers.length });
  // Tile copies committed by the preceding edit belong to that edit, not to this capture span.
  takeRasterHistoryCopiedPixels();
  const rasterIds = rasterBufferIds(doc.layers);
  const snap = { doc, buffers: snapshotHistoryBuffers(rasterIds), sel: getSelection(doc.id), layers: useLayerSelection.getState().byDoc[doc.id], objects: objectPicks(doc.id) };
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

/** Undo steps always kept, even over the byte limit (the newest ones: the last changes can always be undone). */
export const MIN_UNDO_STEPS = 3;

/**
 * Drops the oldest undo steps until the steps hold at most `limit` bytes, never leaving fewer than MIN_UNDO_STEPS undo
 * steps. Returns how many steps were dropped.
 */
export function trimByBytes<T extends { buffers: ReadonlyMap<string, unknown> }>(past: T[], future: T[], limit: number): number {
  let n = 0;
  while (past.length > MIN_UNDO_STEPS && bytesOfSnapshots([...past, ...future]) > limit) {
    past.shift();
    n++;
  }
  return n;
}

/** Sets the byte limit of the undo history (the MIN_UNDO_STEPS newest undo steps are kept regardless). */
export function setHistoryByteLimit(bytes: number): void {
  historyByteLimit = Math.max(0, bytes);
}

function trimStack(docId: string, s: Stack): void {
  const n = trimByBytes(s.past, s.future, historyByteLimit);
  if (n > 0) dropped.set(docId, (dropped.get(docId) ?? 0) + n);
}

/** Open groups by document: the first `record` inside one is its undo step, the later ones add nothing (ADR 0030). */
const groups = new Map<string, { first: Snapshot | null; extra: number }>();

/**
 * Makes every change to this document until `close` one undo step: a command, or a sequence of them. `revert` puts
 * pixels and picks back as they were at the first change, takes that step out and returns the document of then (or
 * null when nothing was recorded); the caller stores it.
 */
export function openHistoryGroup(docId: string, opts: { join?: boolean } = {}): { close(): void; revert(): DesignDoc | null } {
  if (opts.join && groups.has(docId)) return { close() {}, revert: () => null };
  const group = { first: null as Snapshot | null, extra: 0 };
  groups.set(docId, group);
  const end = () => { if (groups.get(docId) === group) groups.delete(docId); };
  return {
    close: end,
    revert() {
      end();
      const first = group.first;
      if (!first) return null;
      const s = stack(docId), at = s.past.lastIndexOf(first);
      if (at >= 0) s.past.splice(at);
      restoreHistoryBuffers(first.buffers);
      restorePicks(docId, first);
      listeners.forEach((l) => l());
      return first.doc;
    },
  };
}

/** Record the state *before* a change. */
export function record(doc: DesignDoc): void {
  const s = stack(doc.id);
  const group = groups.get(doc.id);
  if (group?.first) {
    group.extra++;
    return;
  }
  s.past.push(capture(doc));
  if (group) group.first = s.past[s.past.length - 1];
  if (s.past.length > LIMIT) s.past.shift();
  s.future = [];
  trimStack(doc.id, s);
  listeners.forEach((l) => l());
}

/** Takes back the step `record` just made, when the gesture ended up changing nothing. */
export function unrecord(doc: DesignDoc): void {
  const group = groups.get(doc.id);
  if (group && group.extra > 0) {
    group.extra--;
    return;
  }
  if (group) group.first = null;
  stack(doc.id).past.pop();
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

/** Identity of the newest undo step, even when a new edit evicts the oldest one. */
export function undoHead(docId: string): object | undefined {
  return stacks.get(docId)?.past.at(-1);
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
