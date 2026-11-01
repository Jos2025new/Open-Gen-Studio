import type { VectorShape } from '../../engine/types';
import { withSegs, type Seg } from '../../engine/design/pathNodes';
import { getDoc, patchLayer } from '../../engine/design/actions';
import { objectPick, onShapeEditLeave, setObjectPick, setShapeEdit, useShapeEdit } from '../../engine/design/objectSelection';
import { markNodeEditSplit, useNodeEditMode } from '../../engine/design/nodeEditMode';
import { pageSegs } from '../../engine/design/pathNodes';
import { uid } from '../../lib/id';

/** Pieces worth a shape: a lone moveto draws nothing. */
export const usablePieces = (pieces: Seg[][]): Seg[][] => pieces.filter((p) => p.length >= 2);

/**
 * Replace `shape` (as it stands in `base`, the layer's shapes) by one shape per piece, each copying the original's
 * attributes (stroke, fill…) with the piece's own geometry. The first piece keeps the original id so node editing
 * goes on; `ids` carries the ids of an earlier call so a live preview keeps stable shapes. One patchLayer = one undo
 * step (`record: false` continues the step a first call recorded). Returns the ids used, in piece order.
 */
export function replaceWithPieces(sessionId: string, docId: string, layerId: string, base: VectorShape[], shape: VectorShape, pieces: Seg[][], opts: { record?: boolean; ids?: string[]; /** false: leave the edit state alone (node editing is ending). */ edit?: boolean } = {}): string[] {
  const ids = pieces.map((_, i) => (i === 0 ? shape.id : opts.ids?.[i] ?? uid('shp')));
  const made = pieces.map((p, i) => ({ ...withSegs(shape, p), id: ids[i], nodeTypes: undefined }) as VectorShape);
  patchLayer(sessionId, docId, layerId, { shapes: base.flatMap((s) => (s.id === shape.id ? made : [s])) }, { record: opts.record });
  const edit = useShapeEdit.getState().byDoc[docId];
  if (edit && opts.edit !== false) setShapeEdit(docId, made.length ? { ...edit, node: undefined, nodes: [] } : null);
  return ids;
}

/**
 * While node editing goes on, the pieces of a cut or erase stay subpaths of the SAME shape (one `d`, same id), so every
 * piece stays editable and the mode continues (Figma). `split` marks the session: leaving node editing then separates
 * them. Fewer than one piece removes the shape. One patchLayer = one undo step (`record: false` continues it).
 */
export function replaceWithSubpaths(sessionId: string, docId: string, layerId: string, base: VectorShape[], shape: VectorShape, pieces: Seg[][], opts: { record?: boolean; split?: boolean } = {}): void {
  if (!pieces.length) {
    patchLayer(sessionId, docId, layerId, { shapes: base.filter((s) => s.id !== shape.id) }, { record: opts.record });
    setShapeEdit(docId, null);
    return;
  }
  const made = { ...withSegs(shape, pieces.flat()), id: shape.id, nodeTypes: undefined } as VectorShape;
  patchLayer(sessionId, docId, layerId, { shapes: base.map((s) => (s.id === shape.id ? made : s)) }, { record: opts.record });
  if (opts.split) markNodeEditSplit(sessionId, subpathsOf(pageSegs(shape)).length);
  const edit = useShapeEdit.getState().byDoc[docId];
  if (edit) setShapeEdit(docId, { ...edit, node: undefined, nodes: [] });
}

/** The subpaths of a path, one Seg[] each (every moveto starts a new one). */
export function subpathsOf(segs: Seg[]): Seg[][] {
  const out: Seg[][] = [];
  for (const s of segs) { if (s.c === 'M' || !out.length) out.push([]); out[out.length - 1].push(s); }
  return out;
}

/** Leaving node editing after a cut or erase: the subpaths become individual shapes (original attributes), all picked, in one undo step. */
onShapeEditLeave((docId, prev) => {
  const split = useNodeEditMode.getState().split;
  if (!split) return;
  useNodeEditMode.setState({ split: null });
  const layer = getDoc(split.sessionId, docId)?.layers.find((l) => l.id === prev.layerId);
  const shape = layer?.type === 'vector' ? layer.shapes.find((s) => s.id === prev.shapeId) : undefined;
  if (!layer || layer.type !== 'vector' || !shape || shape.type !== 'path') return;
  const pieces = usablePieces(subpathsOf(pageSegs(shape)));
  if (pieces.length < 2 || pieces.length <= split.before) return;
  const ids = replaceWithPieces(split.sessionId, docId, layer.id, layer.shapes, shape, pieces, { edit: false });
  // Done, Esc or a tool change keep the pick on the shape: it becomes all its pieces. A click elsewhere keeps its own pick.
  const pick = objectPick(docId);
  if (pick?.layerId === layer.id && pick.ids.length === 1 && pick.ids[0] === shape.id) setObjectPick(docId, { layerId: layer.id, ids });
});

/** Current vector shapes of a layer (empty when it is gone). */
export function layerShapes(sessionId: string, docId: string, layerId: string): VectorShape[] {
  const l = getDoc(sessionId, docId)?.layers.find((x) => x.id === layerId);
  return l?.type === 'vector' ? l.shapes : [];
}
