import type { VectorShape } from '../types';
import { getDoc, patchLayer } from './actions';
import { fixOverlaps } from './pathBoolean';
import { areaOf, restyle } from './shapeBoolean';

/*
 * «Fix overlaps» on one shape (the 2D «Recalculate normals»): a segment dragged back across its own contour folds the
 * path, the fold winds the other way and the nonzero rule shows it as a hole. fixOverlaps (pathBoolean.ts) fills what
 * the outline encloses; here it becomes one undo step that keeps the shape's id and look, fillRule back to nonzero (unset).
 * Two modes: 'fill' straightens the flipped parts (they add, the whole enclosed outline is filled); 'cut' fills the
 * flipped lobes but leaves the overlap where fold and original cancel (+1 and -1) as a hole.
 */

export type FixMode = 'fill' | 'cut';
export const FIX_MODES: Array<{ value: FixMode; label: string; tip: string }> = [
  { value: 'fill', label: 'Fill', tip: 'Fill: flipped parts are straightened and add, everything the outline encloses is filled' },
  { value: 'cut', label: 'Cut', tip: 'Cut: flipped parts are filled but where they overlap the original the overlap stays empty' },
];

/** Only a filled path that is not a primitive can cross itself. */
export function fixOverlapsState(s: VectorShape): { ok: boolean; tip: string } {
  if (s.type !== 'path' || s.prim) return { ok: false, tip: 'Rectangles, ellipses and polygons cannot cross themselves' };
  if (!s.fill && !s.fillGradient) return { ok: false, tip: 'Fix overlaps works on filled paths' };
  return { ok: true, tip: 'Resolve self-crossings (Fill or Cut)' };
}

/** Returns true when the path changed (and one undo step was recorded); a path without crossings is left alone. */
export function fixShapeOverlaps(sessionId: string, docId: string, layerId: string, shape: VectorShape, mode: FixMode = 'fill'): boolean {
  if (!fixOverlapsState(shape).ok) return false;
  const l = getDoc(sessionId, docId)?.layers.find((x) => x.id === layerId);
  if (l?.type !== 'vector') return false;
  const area = areaOf(shape), segs = fixOverlaps(area, undefined, mode);
  if (segs === area.segs) return false;
  const next = restyle(shape, segs, shape.id); // restyle leaves fillRule unset = nonzero
  patchLayer(sessionId, docId, layerId, { shapes: (l.shapes as VectorShape[]).map((s) => (s.id === shape.id ? next : s)) });
  return true;
}
