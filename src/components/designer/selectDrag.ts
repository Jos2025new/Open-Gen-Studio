import type { DesignDoc } from '../../engine/types';
import { combineSelection, getSelection, setSelection, type SelectCombine } from '../../engine/design/pixelSelection';
import { record } from '../../engine/design/history';
import { getDoc } from '../../engine/design/actions';
import { downMods, type Mods } from '../../engine/design/modifierGate';
import { boxOutline } from '../../engine/design/selectGeometry';
import { setReadout } from './selectDraw';

type Pt = { x: number; y: number };
type Outline = Array<[number, number]>;

/** A selection being dragged: a rectangle or an ellipse between the first and the latest point, or a lasso through all of them. */
export interface DragGesture {
  kind: 'select'; shape: 'rect' | 'ellipse' | 'lasso'; points: Outline; combine: SelectCombine;
  /** Shift and Alt held at the press belong to the Mode; they count for the shape once let go and pressed again. */
  gate: { shift: boolean; alt: boolean };
  /** The latest pointer, so a key pressed with the mouse still can redraw the outline. */
  cur: Pt;
}

export const dragDown = (p: Pt, shape: DragGesture['shape'], combine: SelectCombine): DragGesture => {
  const down = downMods();
  return { kind: 'select', shape, points: [[p.x, p.y]], combine, gate: { shift: down.shift, alt: down.alt }, cur: p };
};

/** The outline to show as the pointer moves (or as Shift / Alt change under a still pointer: pass `p` as the last point). */
export function dragMove(g: DragGesture, p: Pt, zoom: number, mods?: Mods): Outline {
  g.cur = p;
  if (mods) { if (!mods.shift) g.gate.shift = false; if (!mods.alt) g.gate.alt = false; }
  if (g.shape === 'lasso') {
    const last = g.points[g.points.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) * zoom >= 2) g.points.push([p.x, p.y]);
    return [...g.points];
  }
  const start = { x: g.points[0][0], y: g.points[0][1] };
  const o = boxOutline(g.shape, start, p, { square: Boolean(mods?.shift) && !g.gate.shift, centre: Boolean(mods?.alt) && !g.gate.alt });
  setReadout({ x: p.x, y: p.y, w: o.w, h: o.h });
  return o.points;
}

/** Pointer up: the outline becomes the selection (or combines with it); a click without a drag clears it. */
export function dragUp(g: DragGesture, a: { sessionId: string; doc: DesignDoc; draft: Outline | null; zoom: number }): void {
  setReadout(null);
  const { doc, zoom } = a;
  const pts = a.draft ?? [];
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const tiny = !pts.length || (Math.max(...xs) - Math.min(...xs)) * zoom < 3 || (Math.max(...ys) - Math.min(...ys)) * zoom < 3;
  // A selection change is an undo step of its own (as in GIMP and Krita), unless nothing changes.
  if (!(tiny && (g.combine !== 'replace' || !getSelection(doc.id)))) record(getDoc(a.sessionId, doc.id) ?? doc);
  if (g.combine === 'replace') setSelection(doc.id, tiny ? null : { points: pts });
  else if (!tiny) combineSelection(doc, { points: pts }, g.combine);
}
