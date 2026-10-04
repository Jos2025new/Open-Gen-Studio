import type { DesignDoc } from '../types';
import { rasterBufferIds, restoreBuffers, snapshotBuffers } from './raster';
import { getSelection, setSelection, type PixelSelection } from './pixelSelection';
import { useLayerSelection } from './selection';
import { objectPick, setObjectPick, type ObjectPick } from './objectSelection';

/* Undo/redo for Designer documents. Raster pixels are captured by reference (copy-on-write buffers). */

interface Snapshot {
  doc: DesignDoc;
  buffers: Map<string, HTMLCanvasElement>;
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
  const rasterIds = rasterBufferIds(doc.layers.filter((l) => l.type === 'raster'));
  return { doc, buffers: snapshotBuffers(rasterIds), sel: getSelection(doc.id), layers: useLayerSelection.getState().byDoc[doc.id], objects: objectPick(doc.id) };
}

/** Record the state *before* a change. */
export function record(doc: DesignDoc): void {
  const s = stack(doc.id);
  s.past.push(capture(doc));
  if (s.past.length > LIMIT) s.past.shift();
  s.future = [];
  listeners.forEach((l) => l());
}

export function undo(current: DesignDoc): DesignDoc | null {
  const s = stack(current.id);
  const prev = s.past.pop();
  if (!prev) return null;
  s.future.push(capture(current));
  restoreBuffers(prev.buffers);
  restorePicks(current.id, prev);
  listeners.forEach((l) => l());
  return prev.doc;
}

export function redo(current: DesignDoc): DesignDoc | null {
  const s = stack(current.id);
  const next = s.future.pop();
  if (!next) return null;
  s.past.push(capture(current));
  restoreBuffers(next.buffers);
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
export function historyDepth(docId: string): { undo: number; redo: number } {
  return { undo: stacks.get(docId)?.past.length ?? 0, redo: stacks.get(docId)?.future.length ?? 0 };
}
