import { getDoc, patchLayer } from './actions';
import { objectPick, setObjectPick, setShapeEdit, useObjectSelection } from './objectSelection';
import type { DesignDoc, Layer } from '../types';
import type { Stroke } from '../strokeTypes';
import { cutStroke, cutStrokeAcross, eraseStroke, nearestOnStroke } from './strokeCut';
import { bakeStroke } from './strokes';

/* Stroke edit (Lineart strokes picked with Edit → «Edit nodes»): shares ShapeEdit with `strokes: true`, so the transform handles hide and Done / Esc / a tool change leave it. */

/** The picked Lineart strokes: every picked id is a stroke of one visible, unlocked vector layer. */
export function pickedStrokes(doc: DesignDoc, pick: { layerId: string; ids: string[] } | null | undefined): { layerId: string; strokes: Stroke[] } | null {
  const l = pick && doc.layers.find((x) => x.id === pick.layerId);
  if (!pick || !l || l.type !== 'vector' || l.locked || !l.visible) return null;
  const strokes = pick.ids.map((id) => l.strokes?.find((s) => s.id === id));
  return strokes.length && strokes.every(Boolean) ? { layerId: l.id, strokes: strokes as Stroke[] } : null;
}

export function usePickedStrokes(doc: DesignDoc) {
  return pickedStrokes(doc, useObjectSelection((st) => st.byDoc[doc.id]));
}

export function editStrokes(docId: string, layerId: string, ids: string[]): void {
  setObjectPick(docId, { layerId, ids });
  setShapeEdit(docId, { layerId, shapeId: ids[0], strokes: true });
}

/** Replace some strokes of a layer by their pieces (in place) and keep every piece picked. `record: false` continues the undo step of an earlier call. */
function replace(sessionId: string, docId: string, layerId: string, map: (s: Stroke) => Stroke[], opts: { record?: boolean }): boolean {
  const doc = getDoc(sessionId, docId), pick = doc && pickedStrokes(doc, objectPick(docId));
  const layer = doc?.layers.find((l) => l.id === layerId);
  if (!doc || !pick || pick.layerId !== layerId || layer?.type !== 'vector') return false;
  const picked = new Set(pick.strokes.map((s) => s.id)), ids: string[] = [];
  let changed = false;
  const strokes = (layer.strokes ?? []).flatMap((s) => {
    if (!picked.has(s.id)) return [s];
    const out = map(s);
    if (out.length !== 1 || out[0] !== s) changed = true;
    out.forEach((o) => ids.push(o.id));
    return out;
  });
  if (!changed) return false;
  // The pick moves to the pieces first: patchLayer prunes picks that name strokes the new layer no longer has.
  setObjectPick(docId, ids.length ? { layerId, ids } : null);
  patchLayer(sessionId, docId, layerId, { strokes } as Partial<Layer>, { record: opts.record });
  return true;
}

/** Cut the picked stroke nearest to the click (page px, `reach` beyond half its width); false when it misses (no undo step). */
export function cutPickedStrokes(sessionId: string, docId: string, layerId: string, x: number, y: number, reach: number): boolean {
  const doc = getDoc(sessionId, docId), pick = doc && pickedStrokes(doc, objectPick(docId));
  if (!pick) return false;
  let target: Stroke | null = null, best = Infinity;
  for (const s of pick.strokes) {
    const d = (nearestOnStroke(s, x, y)?.distance ?? Infinity) - bakeStroke(s).size / 2;
    if (d <= reach && d < best) { best = d; target = s; }
  }
  const hit = target;
  return !!hit && replace(sessionId, docId, layerId, (s) => (s === hit ? cutStroke(s, x, y, reach + bakeStroke(s).size / 2) : [s]), {});
}

/** Cut every picked stroke at each crossing of the line a→b (page px); false when it crosses none (no undo step). */
export function cutPickedStrokesAcross(sessionId: string, docId: string, layerId: string, a: [number, number], b: [number, number]): boolean {
  return replace(sessionId, docId, layerId, (s) => cutStrokeAcross(s, a, b), {});
}

/** Rub a circle out of the picked strokes (page px). The first change records the undo step; pass `record: false` afterwards. */
export function erasePickedStrokes(sessionId: string, docId: string, layerId: string, center: [number, number], radius: number, record: boolean): boolean {
  return replace(sessionId, docId, layerId, (s) => eraseStroke(s, center, radius), { record });
}
