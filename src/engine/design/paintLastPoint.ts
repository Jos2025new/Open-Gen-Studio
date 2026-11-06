import type { DesignDoc } from '../types';

/** Where the last brush or eraser stroke ended, by document, layer and brush/eraser: the start of a Shift+click straight line. */
const ends = new Map<string, { x: number; y: number }>();
const key = (docId: string, layerId: string, erase: boolean) => `${docId}\n${layerId}\n${erase ? 'e' : 'b'}`;

/** Remember where a stroke ended (called when a paint gesture commits). */
export function rememberPaintEnd(docId: string, layerId: string, erase: boolean, at: { x: number; y: number }): void {
  ends.set(key(docId, layerId, erase), { x: at.x, y: at.y });
}

/**
 * The point a straight line starts from: the end of the last stroke on this layer, when `shift` is held. null otherwise
 * (no Shift, no earlier stroke, another layer, or the layer is gone), so a stroke starts where the pointer is. After an undo
 * it may point at a stroke that no longer exists; that is accepted.
 */
export function lastPaintPoint(doc: DesignDoc, layerId: string, erase: boolean, shift = false): { x: number; y: number } | null {
  if (!shift || !doc.layers.some((l) => l.id === layerId)) return null;
  return ends.get(key(doc.id, layerId, erase)) ?? null;
}
