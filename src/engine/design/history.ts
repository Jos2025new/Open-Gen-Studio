import type { DesignDoc } from '../types';
import { restoreBuffers, snapshotBuffers } from './raster';

/* Undo/redo for Designer documents. Raster pixels are captured by reference (copy-on-write buffers). */

interface Snapshot {
  doc: DesignDoc;
  buffers: Map<string, HTMLCanvasElement>;
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

function capture(doc: DesignDoc): Snapshot {
  const rasterIds = doc.layers.filter((l) => l.type === 'raster').map((l) => l.id);
  return { doc, buffers: snapshotBuffers(rasterIds) };
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
  listeners.forEach((l) => l());
  return prev.doc;
}

export function redo(current: DesignDoc): DesignDoc | null {
  const s = stack(current.id);
  const next = s.future.pop();
  if (!next) return null;
  s.past.push(capture(current));
  restoreBuffers(next.buffers);
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
