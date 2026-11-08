import { create } from 'zustand';
import { resetNodeEditMode } from './nodeEditMode';

/*
 * Objects picked with the Edit tool in Objects mode: strokes of a painted layer, shapes and Lineart strokes of a vector
 * layer. One flat list that may span several layers (Illustrator, Inkscape, Graphite): a group per layer, in the order
 * the layers were first picked. Kept out of the persisted store, like the layer pick (selecting never saves).
 * Align, Transform, dragging, Delete and the look fields act on every group, each object edited in its own layer.
 */
export interface ObjectPick {
  layerId: string;
  ids: string[];
}

export const useObjectSelection = create<{ byDoc: Record<string, ObjectPick[] | undefined> }>(() => ({ byDoc: {} }));

const clean = (picks: readonly ObjectPick[] | null | undefined): ObjectPick[] => {
  const out: ObjectPick[] = [];
  for (const p of picks ?? []) {
    const ids = [...new Set(p.ids)];
    const at = out.findIndex((q) => q.layerId === p.layerId);
    if (at >= 0) out[at] = { layerId: p.layerId, ids: [...new Set([...out[at].ids, ...ids])] };
    else if (ids.length) out.push({ layerId: p.layerId, ids });
  }
  return out;
};

/** Every picked object, grouped by layer (empty when nothing is picked). */
export function objectPicks(docId: string): ObjectPick[] {
  return useObjectSelection.getState().byDoc[docId] ?? [];
}

/** The pick when every picked object lives in one layer; null for none or for several layers. */
export function onlyPick(picks: readonly ObjectPick[] | null | undefined): ObjectPick | null {
  return picks && picks.length === 1 && picks[0].ids.length ? picks[0] : null;
}

export function pickedCount(picks: readonly ObjectPick[] | null | undefined): number {
  return (picks ?? []).reduce((n, p) => n + p.ids.length, 0);
}

/** Ids picked in one layer. */
export function pickedIn(picks: readonly ObjectPick[] | null | undefined, layerId: string): string[] {
  return picks?.find((p) => p.layerId === layerId)?.ids ?? [];
}

/** True when the object is picked. */
export function isPicked(picks: readonly ObjectPick[] | null | undefined, layerId: string, id: string): boolean {
  return pickedIn(picks, layerId).includes(id);
}

export function setObjectPicks(docId: string, picks: readonly ObjectPick[] | null): void {
  const next = clean(picks);
  useObjectSelection.setState((s) => ({ byDoc: { ...s.byDoc, [docId]: next.length ? next : undefined } }));
  // Shape edit mode lives only while its shape is the one picked object (docs/plan-edicion-formas.md).
  const e = useShapeEdit.getState().byDoc[docId];
  const only = onlyPick(next);
  if (e && !(only?.layerId === e.layerId && (e.strokes || (only.ids.length === 1 && only.ids[0] === e.shapeId)))) setShapeEdit(docId, null);
}

/** Pick the objects of one layer only (everything else is dropped). */
export function setObjectPick(docId: string, pick: ObjectPick | null): void {
  setObjectPicks(docId, pick ? [pick] : null);
}

/** The shape being edited (double-click or «Edit shape»): its own knots show, the transform handles hide. */
export interface ShapeEdit { layerId: string; shapeId: string; /** Lineart strokes edit (strokeEdit.ts): the picked strokes of the layer, any number. */ strokes?: boolean; /** Path edit: selected node indices; node remains as the primary index for existing controls. */ node?: number; nodes?: number[]; /** Segment / face select (selectMode.ts): the selected segments (start-node index) and faces (subpath index) the nodes stand for; read only while they match `nodes`. */ segs?: number[]; faces?: number[]; /** Explicit multi-path node selection; legacy fields above remain the single-path contract. */ paths?: Array<{ layerId: string; shapeId: string; nodes: number[] }> }
export const useShapeEdit = create<{ byDoc: Record<string, ShapeEdit | undefined> }>(() => ({ byDoc: {} }));
/** Called when node editing of a shape ends or moves to another shape, before the mode resets (pathPieces.ts separates cut pieces here). */
let leaveHook: ((docId: string, prev: ShapeEdit) => void) | null = null;
export function onShapeEditLeave(fn: (docId: string, prev: ShapeEdit) => void): void { leaveHook = fn; }
export function setShapeEdit(docId: string, edit: ShapeEdit | null): void {
  // Node-edit mode returns to Move when editing starts, ends or changes shape.
  const prev = useShapeEdit.getState().byDoc[docId];
  if (prev && (!edit || prev.shapeId !== edit.shapeId)) leaveHook?.(docId, prev);
  if (!prev || !edit || prev.shapeId !== edit.shapeId) resetNodeEditMode();
  useShapeEdit.setState((s) => ({ byDoc: { ...s.byDoc, [docId]: edit ?? undefined } }));
}
/** Enter edit mode on one shape: it becomes the only picked object. */
export function editShape(docId: string, layerId: string, shapeId: string): void {
  setObjectPick(docId, { layerId, ids: [shapeId] });
  setShapeEdit(docId, { layerId, shapeId });
}

/** Plain click: only this object. Ctrl-click: add it (from any layer) or take it out. */
export function pickObject(docId: string, layerId: string, id: string, additive: boolean): void {
  const cur = objectPicks(docId);
  if (!additive) return setObjectPicks(docId, [{ layerId, ids: [id] }]);
  if (isPicked(cur, layerId, id)) return setObjectPicks(docId, cur.map((p) => (p.layerId === layerId ? { layerId, ids: p.ids.filter((x) => x !== id) } : p)));
  setObjectPicks(docId, pickedIn(cur, layerId).length ? cur.map((p) => (p.layerId === layerId ? { layerId, ids: [...p.ids, id] } : p)) : [...cur, { layerId, ids: [id] }]);
}
