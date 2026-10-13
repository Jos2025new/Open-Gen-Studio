import { getDoc } from './actions';
import { commitObjects, translateObjects } from './objectOps';

/*
 * Arrow keys move the picked objects (strokes, shapes) by one document pixel (Shift: ten); with nothing picked they pan
 * the view (panOffset). A burst of presses is one undo step: the first press of a burst records it, the presses that
 * follow within BURST_MS share it, as a drag does.
 */
const BURST_MS = 600;
let last = { doc: '', at: 0 };

/** The picked objects of one layer (strokes, shapes) move with the same burst rule; the layer itself does not. */
export function nudgeObjects(sessionId: string, docId: string, layerId: string, ids: readonly string[], dx: number, dy: number): boolean {
  const doc = getDoc(sessionId, docId);
  const layer = doc?.layers.find((l) => l.id === layerId);
  if (!doc || !layer || !ids.length) return false;
  if (layer.locked) return false;
  const now = Date.now();
  const first = last.doc !== docId || now - last.at > BURST_MS;
  last = { doc: docId, at: now };
  commitObjects(sessionId, docId, translateObjects(layer, [...ids], dx, dy), first);
  return true;
}

/** The view moved by an arrow with nothing picked: one step of 20 screen px (Shift: 100). */
export function panOffset(view: { x: number; y: number }, ux: number, uy: number, shift: boolean): { x: number; y: number } {
  const k = shift ? 100 : 20;
  return { x: view.x + ux * k, y: view.y + uy * k };
}
