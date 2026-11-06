import type { DesignDoc } from '../../engine/types';
import { getSelection, setSelection } from '../../engine/design/pixelSelection';
import { moveOffset, pointInSelection, translateSelection } from '../../engine/design/selectionMove';
import { record } from '../../engine/design/history';
import { getDoc } from '../../engine/design/actions';
import { setOutlineShift } from './selectDraw';
import type { SelectDown } from './StageSelect';

/* Moving the outline without moving pixels. A press inside the selection (Mode New, no keys, rectangle / ellipse / lasso) grabs it. */

type Pt = { x: number; y: number };

/** A selection outline being carried. `points` stays empty so the Stage's draft never hides the selection itself. */
export interface MoveGesture { kind: 'select'; move: true; points: []; docId: string; start: Pt; dx: number; dy: number; moved: boolean }

export const isMove = (g: { kind: 'select' }): g is MoveGesture => 'move' in g;

export function moveOutlineDown(a: SelectDown): MoveGesture | null {
  if (a.shape === 'polygon' || a.shape === 'wand' || a.mods.shift || a.mods.alt || a.mods.ctrl) return null;
  const sel = getSelection(a.doc.id);
  if (!sel || !pointInSelection(a.doc, sel, a.p.x, a.p.y)) return null;
  return { kind: 'select', move: true, points: [], docId: a.doc.id, start: a.p, dx: 0, dy: 0, moved: false };
}

/** The pointer moved: nothing is recomputed, the stored outline is drawn shifted. Under 3 screen pixels it is still a click. */
export function moveMove(g: MoveGesture, p: Pt, zoom: number): Array<[number, number]> {
  g.dx = p.x - g.start.x;
  g.dy = p.y - g.start.y;
  if (!g.moved && Math.hypot(g.dx, g.dy) * zoom < 3) return [];
  g.moved = true;
  const sel = getSelection(g.docId);
  const o = sel ? moveOffset(sel, g.dx, g.dy) : { dx: g.dx, dy: g.dy };
  setOutlineShift(o);
  return [];
}

/** Pointer up: the outline lands where it was dropped, one undo step. A click without a drag changes nothing. */
export function moveUp(g: MoveGesture, a: { sessionId: string; doc: DesignDoc }): void {
  setOutlineShift(null);
  const sel = getSelection(g.docId);
  if (!g.moved || !sel) return;
  const o = moveOffset(sel, g.dx, g.dy);
  if (!o.dx && !o.dy) return;
  record(getDoc(a.sessionId, a.doc.id) ?? a.doc);
  setSelection(g.docId, translateSelection(a.doc, sel, g.dx, g.dy));
}
