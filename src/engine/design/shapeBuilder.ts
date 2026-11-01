import type { DesignDoc, VectorShape } from '../types';
import { toast } from '../../store/store';
import { getDoc, patchLayer } from './actions';
import { objectPick, setObjectPick } from './objectSelection';
import { faces as planarFaces, flatten, mergeFaces } from './pathBoolean';
import type { Pt, Seg } from './pathNodes';
import { areaOf, booleanShapes, isFillable, restyle, type BoolOp } from './shapeBoolean';

/*
 * Applying booleans and the Shape Builder to the document. Both read the shapes picked in one vector layer (picks never
 * span layers in Objects mode, so the result always stays in the layer of the picks), replace them in one undo step and
 * leave the results picked. The builder follows Illustrator / vectorcraft (crates/engine/src/cmd/buildcmds/
 * shape_builder.rs; MIT OR Apache-2.0): faces are computed once per set of shapes, a gesture merges (or deletes) the
 * faces it touched, and every original keeps the faces that were not touched as its remaining part.
 */

/** The picked shapes of a vector layer you can edit, back to front; null when fewer than two shapes are picked. */
export function pickedShapes(doc: DesignDoc, pick: { layerId: string; ids: string[] } | null | undefined): { layerId: string; shapes: VectorShape[] } | null {
  const layer = pick && doc.layers.find((l) => l.id === pick.layerId);
  if (!pick || layer?.type !== 'vector' || layer.locked || !layer.visible) return null;
  const shapes = (layer.shapes as VectorShape[]).filter((s) => pick.ids.includes(s.id));
  return shapes.length >= 2 ? { layerId: layer.id, shapes } : null;
}

/**
 * Replace `inputs` by `results`: a result with an input's id takes that input's place, the new ones go at the place of
 * the top-most input, the rest of the layer stays. One undo step; the results end up picked.
 */
function replaceShapes(sessionId: string, docId: string, layerId: string, inputs: VectorShape[], results: VectorShape[]): void {
  const layer = getDoc(sessionId, docId)?.layers.find((l) => l.id === layerId);
  if (layer?.type !== 'vector') return;
  const gone = new Set(inputs.map((s) => s.id)), top = Math.max(...layer.shapes.map((s, i) => (gone.has(s.id) ? i : -1)));
  const byId = new Map(results.map((r) => [r.id, r])), fresh = results.filter((r) => !gone.has(r.id));
  const shapes = layer.shapes.flatMap((s, i) => {
    const same = gone.has(s.id) ? byId.get(s.id) : s;
    return i === top ? [...(same ? [same] : []), ...fresh] : same ? [same] : [];
  });
  patchLayer(sessionId, docId, layerId, { shapes });
  setObjectPick(docId, { layerId, ids: results.map((s) => s.id) });
}

/** Run a boolean operation on the picked shapes. Returns the message shown to the user when nothing was done. */
export function applyBoolean(sessionId: string, docId: string, op: BoolOp): string | null {
  const doc = getDoc(sessionId, docId);
  const got = doc && pickedShapes(doc, objectPick(docId));
  if (!got) return 'Pick two or more shapes (Edit tool, Shift-click) in an unlocked vector layer.';
  const out = booleanShapes(op, got.shapes);
  if (typeof out === 'string') { toast(out, 'info', 5000); return out; }
  // Ignored shapes (open paths with no fill) stay where they were.
  replaceShapes(sessionId, docId, got.layerId, got.shapes.filter((s) => op === 'divide' || isFillable(s)), out.shapes);
  if (out.ignored) toast(`${out.ignored} open path${out.ignored === 1 ? '' : 's'} without fill ${out.ignored === 1 ? 'was' : 'were'} left out.`, 'info', 5000);
  return null;
}

// ------------------------------------------------------------------ Shape Builder

export interface BuilderModel {
  /** The fillable shapes the faces were computed from, back to front. */
  shapes: VectorShape[];
  /** null: too complex. */
  faces: Array<{ segs: Seg[]; sources: number[]; rings: Pt[][] }> | null;
}
let cached: BuilderModel | null = null;

/** The planar faces of the shapes, computed once while the very same shape objects are picked. */
export function builderModel(picked: VectorShape[]): BuilderModel {
  const shapes = picked.filter(isFillable);
  if (cached && cached.shapes.length === shapes.length && cached.shapes.every((s, i) => s === shapes[i])) return cached;
  const found = shapes.length >= 2 ? planarFaces(shapes.map(areaOf)) : [];
  cached = { shapes, faces: found && found.map((f) => ({ ...f, rings: flatten(f.segs, 0.25).map((r) => r.points) })) };
  return cached;
}

/** The face under a page point (even-odd over its outer contour and holes), or -1. */
export function faceAt(model: BuilderModel, p: Pt): number {
  return model.faces?.findIndex((f) => {
    let inside = false;
    for (const ring of f.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }) ?? -1;
}

/**
 * One builder gesture: `touched` faces are merged into one new shape (styled like the top-most shape covering face
 * `start`, else the first touched face) or deleted. Each original keeps its untouched faces (restyled like itself) and
 * disappears when none are left; originals the gesture did not reach stay exactly as they were.
 */
export function applyBuilder(sessionId: string, docId: string, layerId: string, ids: string[], touched: number[], mode: 'merge' | 'delete', start = -1): boolean {
  const doc = getDoc(sessionId, docId), layer = doc?.layers.find((l) => l.id === layerId);
  if (layer?.type !== 'vector' || layer.locked || !touched.length) return false;
  const model = builderModel((layer.shapes as VectorShape[]).filter((s) => ids.includes(s.id)));
  if (!model.faces) return false;
  const hit = new Set(touched.filter((i) => model.faces![i]));
  if (!hit.size) return false;
  const kept = (i: number) => model.faces!.filter((f, k) => f.sources.includes(i) && !hit.has(k));
  const reached = (i: number) => model.faces!.some((f, k) => f.sources.includes(i) && hit.has(k));
  const results: VectorShape[] = [];
  model.shapes.forEach((s, i) => {
    if (!reached(i)) { results.push(s); return; }
    const rest = kept(i);
    const segs = rest.length ? mergeFaces(rest.map((f) => f.segs)) : [];
    if (segs.length) results.push(restyle(s, segs, s.id));
  });
  if (mode === 'merge') {
    const lead = hit.has(start) ? start : [...hit][0];
    const segs = mergeFaces([...hit].map((i) => model.faces![i].segs));
    if (segs.length) results.push(restyle(model.shapes[Math.max(...model.faces![lead].sources)], segs));
  }
  replaceShapes(sessionId, docId, layerId, model.shapes, results);
  return true;
}
