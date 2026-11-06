import type { DesignDoc } from '../../engine/types';
import { combineSelection, getSelection, rectPoints, setSelection, type SelectCombine } from '../../engine/design/pixelSelection';
import { record } from '../../engine/design/history';
import { getDoc } from '../../engine/design/actions';

/** A selection being dragged: a rectangle between the first and the latest point, or a lasso through all of them. */
export interface DragGesture { kind: 'select'; lasso: boolean; points: Array<[number, number]>; combine: SelectCombine }

export const dragDown = (p: { x: number; y: number }, lasso: boolean, combine: SelectCombine): DragGesture => ({ kind: 'select', lasso, points: [[p.x, p.y]], combine });

/** The outline to show as the pointer moves. */
export function dragMove(g: DragGesture, p: { x: number; y: number }, zoom: number): Array<[number, number]> {
  if (!g.lasso) return rectPoints(g.points[0][0], g.points[0][1], p.x, p.y);
  const last = g.points[g.points.length - 1];
  if (Math.hypot(p.x - last[0], p.y - last[1]) * zoom >= 2) g.points.push([p.x, p.y]);
  return [...g.points];
}

/** Pointer up: the outline becomes the selection (or combines with it); a click without a drag clears it. */
export function dragUp(g: DragGesture, a: { sessionId: string; doc: DesignDoc; draft: Array<[number, number]> | null; zoom: number }): void {
  const { doc, zoom } = a;
  const pts = a.draft ?? [];
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const tiny = !pts.length || (Math.max(...xs) - Math.min(...xs)) * zoom < 3 || (Math.max(...ys) - Math.min(...ys)) * zoom < 3;
  // A selection change is an undo step of its own (as in GIMP and Krita), unless nothing changes.
  if (!(tiny && (g.combine !== 'replace' || !getSelection(doc.id)))) record(getDoc(a.sessionId, doc.id) ?? doc);
  if (g.combine === 'replace') setSelection(doc.id, tiny ? null : { points: pts });
  else if (!tiny) combineSelection(doc, { points: pts }, g.combine);
}
