import type { DesignDoc, Layer } from '../types';
import { create } from 'zustand';

/*
 * Several layers selected in the Designer (Ctrl/Shift-click in the layers panel), in the order they were picked.
 * Kept out of the persisted store, like the node selection: selecting must never save state. The document's active
 * layer is always part of it.
 */

export const useLayerSelection = create<{ byDoc: Record<string, string[]> }>(() => ({ byDoc: {} }));

/** The selected layers of a document: its own picks, else just the active layer. */
/** The layers picked, as they were picked (the active layer is not added): what a multiple selection is. */
export function pickedLayers(docId: string, existing: string[]): string[] {
  return (useLayerSelection.getState().byDoc[docId] ?? []).filter((id) => existing.includes(id));
}

export function layerSelection(docId: string, activeLayerId: string | null, existing: string[]): string[] {
  // The active layer is the selection only when nothing is picked: adding it to a stale pick made a plain click
  // add to the old selection ("2 selected").
  const picked = pickedLayers(docId, existing);
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

/** Other movable layers picked alongside this one. */
export function otherPickedLayers(doc: DesignDoc, id: string): Layer[] {
  const picked = layerSelection(doc.id, doc.activeLayerId, doc.layers.map(l => l.id));
  return picked.includes(id) ? doc.layers.filter(l => l.id !== id && picked.includes(l.id) && !l.locked && l.visible) : [];
}
