import type { DesignDoc } from '../../engine/types';
import { combineSelection, setSelection, type SelectCombine } from '../../engine/design/pixelSelection';
import { record } from '../../engine/design/history';
import type { Mods } from '../../engine/design/modifierGate';
import { snapAngle } from '../../engine/design/selectGeometry';
import type { SelectDown } from './StageSelect';

/* Polygon selection: a click is a vertex. It closes on the first vertex, on Enter or on a double click; Esc throws it away. */

type Pt = { x: number; y: number };
type Outline = Array<[number, number]>;

/** Screen pixels within which a click on the first vertex closes the shape / a second click counts as a double click. */
const CLOSE_RADIUS = 8, DOUBLE_RADIUS = 5, DOUBLE_MS = 350;

interface Draft { doc: DesignDoc; combine: SelectCombine; verts: Outline; hover: Pt | null; shiftHeld: boolean; at: number }
let draft: Draft | null = null;

/** The vertices placed so far. */
export const polygonVertices = (): Outline => draft?.verts ?? [];

/** The outline to show: the vertices and the rubber band up to the pointer; null when no polygon is open. */
export function polygonDraft(): Outline | null {
  if (!draft) return null;
  return draft.hover ? [...draft.verts, [draft.hover.x, draft.hover.y]] : [...draft.verts];
}

/** Shift forces the last segment to a 45-degree step, once it was pressed after the press that set the Mode. */
function place(d: Draft, p: Pt, mods: Mods): Pt {
  if (!mods.shift) d.shiftHeld = false;
  const last = d.verts[d.verts.length - 1];
  return mods.shift && !d.shiftHeld && last ? snapAngle({ x: last[0], y: last[1] }, p) : p;
}

const area = (v: Outline): number => v.reduce((s, [x, y], i) => s + x * v[(i + 1) % v.length][1] - v[(i + 1) % v.length][0] * y, 0) / 2;

/** Close the shape: fewer than 3 vertices or no area is dropped; otherwise it becomes (or combines with) the selection. */
function finish(): void {
  const d = draft;
  draft = null;
  if (!d || d.verts.length < 3 || Math.abs(area(d.verts)) < 1) return;
  record(d.doc);
  if (d.combine === 'replace') setSelection(d.doc.id, { points: d.verts });
  else combineSelection(d.doc, { points: d.verts }, d.combine);
}

/** A press: the first one opens the polygon (and fixes how it combines), the rest add vertices or close it. */
export function polygonDown(a: SelectDown, combine: SelectCombine): 'handled' {
  const zoom = a.zoom ?? 1, now = Date.now();
  if (!draft || draft.doc.id !== a.doc.id) {
    draft = { doc: a.doc, combine, verts: [[a.p.x, a.p.y]], hover: null, shiftHeld: a.mods.shift, at: now };
    return 'handled';
  }
  const d = draft;
  d.doc = a.doc;
  const p = place(d, a.p, a.mods);
  const first = d.verts[0], last = d.verts[d.verts.length - 1];
  const near = (v: number[], r: number) => Math.hypot(a.p.x - v[0], a.p.y - v[1]) * zoom <= r;
  if (d.verts.length >= 3 && near(first, CLOSE_RADIUS)) finish();
  else if (now - d.at < DOUBLE_MS && near(last, DOUBLE_RADIUS)) finish();
  else { d.verts.push([p.x, p.y]); d.hover = null; d.at = now; }
  return 'handled';
}

/** The pointer moved with no button: the rubber band follows. */
export function polygonHover(p: Pt, mods: Mods): Outline | undefined {
  if (!draft) return undefined;
  draft.hover = place(draft, p, mods);
  return polygonDraft() ?? undefined;
}

/** Esc, Enter or Backspace on the polygon being drawn; true when the key was consumed. */
export function polygonKey(e: KeyboardEvent): boolean {
  if (!draft || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === 'Escape') draft = null;
  else if (e.key === 'Enter') finish();
  else if (e.key === 'Backspace') { draft.verts.pop(); if (!draft.verts.length) draft = null; }
  else return false;
  return true;
}

/** Throw the polygon draft away (tool, shape, document or layer changed). */
export const polygonCancel = (): void => { draft = null; };
