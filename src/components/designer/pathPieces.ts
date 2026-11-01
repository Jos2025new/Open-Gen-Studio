import type { VectorShape } from '../../engine/types';
import { withSegs, type Seg } from '../../engine/design/pathNodes';
import { getDoc, patchLayer } from '../../engine/design/actions';
import { setShapeEdit, useShapeEdit } from '../../engine/design/objectSelection';
import { uid } from '../../lib/id';

/** Pieces worth a shape: a lone moveto draws nothing. */
export const usablePieces = (pieces: Seg[][]): Seg[][] => pieces.filter((p) => p.length >= 2);

/**
 * Replace `shape` (as it stands in `base`, the layer's shapes) by one shape per piece, each copying the original's
 * attributes (stroke, fill…) with the piece's own geometry. The first piece keeps the original id so node editing
 * goes on; `ids` carries the ids of an earlier call so a live preview keeps stable shapes. One patchLayer = one undo
 * step (`record: false` continues the step a first call recorded). Returns the ids used, in piece order.
 */
export function replaceWithPieces(sessionId: string, docId: string, layerId: string, base: VectorShape[], shape: VectorShape, pieces: Seg[][], opts: { record?: boolean; ids?: string[] } = {}): string[] {
  const ids = pieces.map((_, i) => (i === 0 ? shape.id : opts.ids?.[i] ?? uid('shp')));
  const made = pieces.map((p, i) => ({ ...withSegs(shape, p), id: ids[i], nodeTypes: undefined }) as VectorShape);
  patchLayer(sessionId, docId, layerId, { shapes: base.flatMap((s) => (s.id === shape.id ? made : [s])) }, { record: opts.record });
  const edit = useShapeEdit.getState().byDoc[docId];
  if (edit) setShapeEdit(docId, made.length ? { ...edit, node: undefined, nodes: [] } : null);
  return ids;
}

/** Current vector shapes of a layer (empty when it is gone). */
export function layerShapes(sessionId: string, docId: string, layerId: string): VectorShape[] {
  const l = getDoc(sessionId, docId)?.layers.find((x) => x.id === layerId);
  return l?.type === 'vector' ? l.shapes : [];
}
