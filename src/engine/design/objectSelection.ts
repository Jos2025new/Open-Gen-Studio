import { create } from 'zustand';

/*
 * Objects picked inside one layer with the Edit tool in Objects mode: strokes of a painted layer, shapes and
 * Lineart strokes of a vector layer. Kept out of the persisted store, like the layer pick (selecting never saves).
 * Align, Transform and dragging act on these, never on the whole layer, while Edit is in Objects mode.
 */
export interface ObjectPick {
  layerId: string;
  ids: string[];
}

export const useObjectSelection = create<{ byDoc: Record<string, ObjectPick | undefined> }>(() => ({ byDoc: {} }));

export function objectPick(docId: string): ObjectPick | null {
  const p = useObjectSelection.getState().byDoc[docId];
  return p && p.ids.length ? p : null;
}

export function setObjectPick(docId: string, pick: ObjectPick | null): void {
  useObjectSelection.setState((s) => ({ byDoc: { ...s.byDoc, [docId]: pick && pick.ids.length ? pick : undefined } }));
}

/** Plain click: only this object. Ctrl-click: add it or take it out (same layer only; another layer starts over). */
export function pickObject(docId: string, layerId: string, id: string, additive: boolean): void {
  const cur = objectPick(docId);
  const same = cur?.layerId === layerId ? cur.ids : [];
  const ids = !additive ? [id] : same.includes(id) ? same.filter((x) => x !== id) : [...same, id];
  setObjectPick(docId, { layerId, ids });
}
