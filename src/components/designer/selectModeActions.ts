import type { VectorShape } from '../../engine/types';
import { nodeSegs, pageSegs, readTypes, withSegs, writeTypes } from '../../engine/design/pathNodes';
import { deleteFaces, deriveSel, edgesOf, effectiveSel, facesOf, type Sel, type SelectMode } from '../../engine/design/selectMode';
import { useNodeEditMode } from '../../engine/design/nodeEditMode';
import { setShapeEdit, useShapeEdit, type ShapeEdit } from '../../engine/design/objectSelection';
import { getDoc, patchLayer } from '../../engine/design/actions';
import { patchShape } from './ShapeLookFields';

/* Segment and face select of the node editor (engine/design/selectMode.ts): switching, writing and deleting. */

/** The select mode in force: Move and Lasso use it, every other node mode works on nodes. */
export function activeSelectMode(): SelectMode {
  const st = useNodeEditMode.getState();
  return st.mode === 'move' || st.mode === 'lasso' ? st.select : 'node';
}

export const nodesOf = (edit?: ShapeEdit): number[] => edit?.nodes ?? (edit?.node == null ? [] : [edit.node]);

/** What the edited shape has selected in `mode`. */
export function currentSel(shape: VectorShape, edit: ShapeEdit | undefined, mode: SelectMode): Sel {
  const segs = pageSegs(shape);
  return effectiveSel(mode === 'segment' ? edgesOf(segs) : [], mode === 'face' ? facesOf(segs, shape.fillRule) : [], mode, nodesOf(edit), edit);
}

/**
 * The segments a per-segment action (Delete segment, Make line / curve) is limited to: the picked ones in Segment mode, so two
 * opposite sides of a square do not drag in the other two; undefined otherwise (Node mode: every segment between selected
 * nodes; Face mode: the faces' own segments). Join, Break and the node types act on the selected nodes in every mode.
 */
export const segOnly = (shape: VectorShape, mode: SelectMode, edit?: ShapeEdit): number[] | undefined => (mode === 'segment' ? currentSel(shape, edit, mode).segs : undefined);

/** Write a selection (nodes plus the segments or faces they stand for) to the shape's edit state. */
export function writeSel(docId: string, edit: ShapeEdit, sel: Sel): void {
  setShapeEdit(docId, { ...edit, node: sel.nodes[0], nodes: sel.nodes, segs: sel.segs.length ? sel.segs : undefined, faces: sel.faces.length ? sel.faces : undefined });
}

/** Switch the element (keys 1 / 2 / 3, the segmented control) and convert the selection like Blender: only whole elements survive. */
export function chooseSelectMode(docId: string, shape: VectorShape, mode: SelectMode): void {
  const edit = useShapeEdit.getState().byDoc[docId];
  const from = activeSelectMode(), mine = edit && edit.shapeId === shape.id && !edit.strokes;
  const cur = mine ? currentSel(shape, edit, from) : null;
  useNodeEditMode.setState({ select: mode });
  if (!mine || !cur) return;
  const segs = pageSegs(shape);
  writeSel(docId, edit, deriveSel(mode === 'segment' ? edgesOf(segs) : [], mode === 'face' ? facesOf(segs, shape.fillRule) : [], mode, cur.nodes));
}

/**
 * Delete in Segment or Face mode (one undo step): the selected segments, or the selected faces' subpaths with their holes.
 * False in Node mode (the node delete applies); true once handled, even if nothing could be deleted, so Delete never falls through.
 */
export function deleteBySelection(sessionId: string, docId: string, layerId: string, shape: VectorShape, mode: SelectMode, setDeleteSegments: (ids: number[]) => void): boolean {
  if (mode === 'node') return false;
  const edit = useShapeEdit.getState().byDoc[docId], sel = currentSel(shape, edit, mode);
  if (mode === 'segment') { if (sel.segs.length) setDeleteSegments(sel.segs); return true; }
  const segs = pageSegs(shape), r = deleteFaces(segs, readTypes(segs, shape.nodeTypes), facesOf(segs, shape.fillRule), sel.faces);
  if (!r) return true;
  if (!nodeSegs(r.segs).seg.length) {
    const layer = getDoc(sessionId, docId)?.layers.find((l) => l.id === layerId);
    if (layer?.type === 'vector') patchLayer(sessionId, docId, layerId, { shapes: layer.shapes.filter((s) => s.id !== shape.id) });
    setShapeEdit(docId, null);
    return true;
  }
  const next = withSegs(shape, r.segs);
  patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(r.segs, r.types) });
  if (edit) setShapeEdit(docId, { ...edit, node: undefined, nodes: [], segs: undefined, faces: undefined });
  return true;
}
