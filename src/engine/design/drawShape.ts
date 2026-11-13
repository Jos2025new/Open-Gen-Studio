import type { DesignDoc, VectorLayer, VectorShape } from '../types';
import { getDoc, mutateDoc, noticeSkippedLayer } from './actions';
import { activeLayer, insertLayer, newVectorLayer, updateLayer } from './doc';
import { setObjectPick } from './objectSelection';

/*
 * Drawing a shape, as Illustrator and Inkscape: layer → groups → objects, and drawing never makes a layer by itself.
 * The shape goes inside the active layer when that one can take it; only when it cannot (an image, a text, hidden,
 * locked) a new vector layer is made, and the next shapes go in it because it becomes the active one.
 * Older documents with one shape per layer read the same: nothing is migrated.
 */

/** The layer the next shape is drawn in: the active one when it is a vector layer that shows and may change. A pixel mask would cut the new shape. */
export function shapeTarget(doc: DesignDoc): VectorLayer | null {
  const act = activeLayer(doc);
  return act && act.type === 'vector' && act.visible && !act.locked && !act.pixelMask ? act : null;
}

/** Pure: the document with the shape drawn. In its layer it sits above the other shapes (lineart strokes stay above every shape). */
export function placeShape(doc: DesignDoc, shape: VectorShape): { doc: DesignDoc; layerId: string; created: boolean } {
  const target = shapeTarget(doc);
  if (target) return { doc: updateLayer(doc, target.id, { shapes: [...target.shapes, shape] }), layerId: target.id, created: false };
  const layer = { ...newVectorLayer(`Layer ${doc.layers.length + 1}`), shapes: [shape] };
  return { doc: insertLayer(doc, layer, 'top'), layerId: layer.id, created: true };
}

/** Draw the shape (one undo step) and leave it picked as an object. Says so when a hidden or locked active layer was skipped. */
export function drawShape(sessionId: string, docId: string, shape: VectorShape): string | null {
  const before = getDoc(sessionId, docId);
  if (!before) return null;
  const placed = placeShape(before, shape);
  mutateDoc(sessionId, docId, () => placed.doc);
  setObjectPick(docId, { layerId: placed.layerId, ids: [shape.id] });
  if (placed.created) noticeSkippedLayer(sessionId, docId, activeLayer(before));
  return placed.layerId;
}
