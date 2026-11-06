import { useEffect } from 'react';
import type { DesignDoc } from '../../engine/types';
import { combineSelection, wandSelection } from '../../engine/design/pixelSelection';
import { record } from '../../engine/design/history';
import { combineFrom, type Mods } from '../../engine/design/modifierGate';
import type { SelectShape } from '../../engine/design/selectShape';
import { toast, useStore } from '../../store/store';
import { dragDown, dragMove, dragUp, type DragGesture } from './selectDrag';
import { polygonCancel, polygonDown, polygonDraft, polygonHover, polygonKey } from './selectPolygon';
import { isMove, moveMove, moveOutlineDown, moveUp, type MoveGesture } from './selectMove';

export { drawSelect } from './selectDraw';

/** The Stage's select tool in one place: it presses, moves and releases for the Select family, whatever the shape. */
export type SelectGesture = DragGesture | MoveGesture;
export type Draft = Array<[number, number]> | null;
export interface SelectDown { doc: DesignDoc; p: { x: number; y: number }; shape: SelectShape; mods: Mods; /** Screen pixels per page pixel: the polygon's closing radius. */ zoom?: number }

/** A press. `'handled'` means nothing is left dragging (the wand, a polygon vertex); null, nothing to do. */
export function selectDown(a: SelectDown): SelectGesture | 'handled' | null {
  // Shift adds to the selection, Alt cuts out of it, Shift+Alt keeps only the overlap; otherwise the Mode chosen for every shape.
  const wand = useStore.getState().ui.wand;
  const combine = combineFrom(a.mods, wand?.mode ?? 'replace');
  if (a.shape === 'wand') {
    const next = wandSelection(a.doc, a.p.x, a.p.y, wand ?? {});
    if (typeof next === 'string') { toast(next, 'error'); return 'handled'; }
    record(a.doc);
    combineSelection(a.doc, next, combine);
    return 'handled';
  }
  if (a.shape === 'polygon') { const g = polygonDown(a, combine); if (g) return g; }
  if (combine === 'replace') { const g = moveOutlineDown(a); if (g) return g; }
  return dragDown(a.p, a.shape === 'lasso' ? 'lasso' : a.shape === 'ellipse' ? 'ellipse' : 'rect', combine);
}

/** The pointer moved with the button down: the outline to show. `mods` are the keys held now (Shift: square, Alt: from the centre). */
export const selectMove = (g: SelectGesture, p: { x: number; y: number }, zoom: number, mods?: Mods): Draft =>
  isMove(g) ? moveMove(g, p, zoom) : dragMove(g, p, zoom, mods);

/** Shift or Alt went down or up with the pointer still: the outline again from the latest point. */
export const selectRefresh = (g: SelectGesture, zoom: number, mods: Mods): Draft | undefined => (isMove(g) ? undefined : dragMove(g, g.cur, zoom, mods));

/**
 * The pointer moved with no button down: the polygon's rubber band. undefined when no polygon is open (leave the draft alone).
 * Also call it after a press that returned 'handled', with `?? null`, to show or clear the draft.
 */
export const selectHover = (p: { x: number; y: number }, mods: Mods): Draft | undefined => polygonHover(p, mods);

export const selectUp = (g: SelectGesture, a: { sessionId: string; doc: DesignDoc; draft: Draft; zoom: number }): void =>
  isMove(g) ? moveUp(g, a) : dragUp(g, a);

/** Cancels a half-drawn polygon when the tool, shape or document changes, and gives it Esc, Enter and Backspace before the shortcuts see them. */
export function useSelectSession(docId: string, tool: string, shape: SelectShape, setDraft?: (d: Draft) => void): void {
  useEffect(() => () => { if (polygonDraft()) setDraft?.(null); polygonCancel(); }, [docId, tool, shape, setDraft]);
  useEffect(() => {
    if (tool !== 'select' || shape !== 'polygon') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (polygonKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); setDraft?.(polygonDraft()); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tool, shape, setDraft]);
}
