import { useEffect } from 'react';
import type { DesignDoc } from '../../engine/types';
import { combineSelection, wandSelection } from '../../engine/design/pixelSelection';
import { record } from '../../engine/design/history';
import { combineFrom, type Mods } from '../../engine/design/modifierGate';
import type { SelectShape } from '../../engine/design/selectShape';
import { toast, useStore } from '../../store/store';
import { dragDown, dragMove, dragUp, type DragGesture } from './selectDrag';
import { polygonCancel, polygonDown, polygonKey } from './selectPolygon';
import { moveOutlineDown } from './selectMove';

export { drawSelect } from './selectDraw';

/** The Stage's select tool in one place: it presses, moves and releases for the Select family, whatever the shape. */
export type SelectGesture = DragGesture;
export type Draft = Array<[number, number]> | null;
export interface SelectDown { doc: DesignDoc; p: { x: number; y: number }; shape: SelectShape; mods: Mods }

/** A press. `'handled'` means nothing is left dragging (the wand, a polygon vertex); null, nothing to do. */
export function selectDown(a: SelectDown): SelectGesture | 'handled' | null {
  // Shift adds to the selection, Alt cuts out of it; otherwise the Mode chosen for every shape (Shift+Alt stays "cut" until the intersect gesture lands).
  const wand = useStore.getState().ui.wand;
  const combine = combineFrom({ shift: a.mods.shift && !a.mods.alt, alt: a.mods.alt }, wand?.mode ?? 'replace');
  if (a.shape === 'wand') {
    const next = wandSelection(a.doc, a.p.x, a.p.y, wand ?? {});
    if (typeof next === 'string') { toast(next, 'error'); return 'handled'; }
    record(a.doc);
    combineSelection(a.doc, next, combine);
    return 'handled';
  }
  if (a.shape === 'polygon') { const g = polygonDown(a); if (g) return g; }
  if (combine === 'replace') { const g = moveOutlineDown(a); if (g) return g; }
  return dragDown(a.p, a.shape === 'lasso', combine);
}

/** The pointer moved with the button down: the outline to show. */
export const selectMove = (g: SelectGesture, p: { x: number; y: number }, zoom: number): Draft => dragMove(g, p, zoom);

/** The pointer moved with no button down (the polygon's rubber band). Skeleton: nothing to show. */
export const selectHover = (_p: { x: number; y: number }, _mods: Mods): Draft | undefined => undefined;

export const selectUp = (g: SelectGesture, a: { sessionId: string; doc: DesignDoc; draft: Draft; zoom: number }): void => dragUp(g, a);

/** Cancels a half-drawn polygon when the tool, shape or document changes, and gives it Esc, Enter and Backspace before the shortcuts see them. */
export function useSelectSession(docId: string, tool: string, shape: SelectShape): void {
  useEffect(() => polygonCancel, [docId, tool, shape]);
  useEffect(() => {
    if (tool !== 'select' || shape !== 'polygon') return;
    const onKey = (e: KeyboardEvent) => { if (polygonKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tool, shape]);
}
