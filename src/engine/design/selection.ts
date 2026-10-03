import { create } from 'zustand';

/*
 * Several layers selected in the Designer (Ctrl/Shift-click in the layers panel), in the order they were picked.
 * Kept out of the persisted store, like the node selection: selecting must never save state. The document's active
 * layer is always part of it.
 */

export const useLayerSelection = create<{ byDoc: Record<string, string[]> }>(() => ({ byDoc: {} }));

/** The selected layers of a document: its own picks, else just the active layer. */
export function layerSelection(docId: string, activeLayerId: string | null, existing: string[]): string[] {
  const picked = (useLayerSelection.getState().byDoc[docId] ?? []).filter((id) => existing.includes(id));
  if (activeLayerId && !picked.includes(activeLayerId)) return [...picked, activeLayerId];
  return picked.length ? picked : activeLayerId ? [activeLayerId] : [];
}

/** Plain click: only this layer. Ctrl/Shift-click: add it, or take it out if it was in. */
export function pickLayer(docId: string, id: string, additive: boolean, current: string[]): string[] {
  const next = !additive ? [id] : current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  useLayerSelection.setState((s) => ({ byDoc: { ...s.byDoc, [docId]: next } }));
  return next;
}

/** Shift-click: every layer between the anchor (the active layer) and this one, as in a file list. */
export function pickLayerRange(docId: string, anchorId: string | null, id: string, order: string[]): string[] {
  const a = anchorId ? order.indexOf(anchorId) : -1, b = order.indexOf(id);
  const next = a < 0 || b < 0 ? [id] : order.slice(Math.min(a, b), Math.max(a, b) + 1);
  useLayerSelection.setState((s) => ({ byDoc: { ...s.byDoc, [docId]: next } }));
  return next;
}
