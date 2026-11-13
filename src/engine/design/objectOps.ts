import { allVectorObjects, maskBounds, maskContains } from './vectorMask';
import { vectorObjectHit } from './objectHit';
import { pickable, shownLayer } from './objectGroupTree';
import type { DesignDoc, Layer, RasterLayer, VectorLayer } from '../types';
import { setDoc, toast, useStore } from '../../store/store';
import { record } from './history';
import { shapeBox, translateLayer } from './doc';
import { looksUnchanged, noChangeNote } from './symmetry';
import { shiftStroke, strokeBox } from './strokes';
import { moveRasterStroke, rasterStrokeBox } from './rasterStrokes';
import {composeRaster} from './rasterCompose';
import { alignBoxDelta, turnVector, unionBoxes, type AlignTo, type Box, type RelativeTo, type Turn } from './transform';
import { pixelsNotReady } from './rasterMissing';
import { hitTestPixel, layerBox } from './render';
import { apply, IDENTITY, invert, multiply, rotateAbout, scaleAbout, type Mat } from './matrix';

/*
 * Edit in Objects mode: the operations act on the objects picked inside the active layer (objectSelection.ts), and
 * leave the layer and its other objects alone. Painted strokes stay editable (the layer is recomposed from its base
 * and strokes, never flattened). One undo step each.
 */

const union = (bs: Box[]): Box | null => {
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
};

/** A text, placed image or raster without individual strokes is one object. */
export function wholeLayerObject(layer: Layer): boolean {
  return layer.type === 'text' || (layer.type === 'raster' && (!layer.paintStrokes?.length || (!!layer.paintBaseId && layer.paintStrokes.every((s) => s.erase))));
}

/** The objects of a layer that can be picked, with their boxes (page coordinates). */
export function layerObjects(layer: Layer): Array<{ id: string; box: Box }> {
  if (wholeLayerObject(layer)) {
    const box = layerBox(layer);
    return box ? [{ id: layer.id, box }] : [];
  }
  if (layer.type === 'raster') {
    const strokes = (layer.paintStrokes ?? []).filter((s) => !s.erase).map((s) => ({ id: s.id, box: rasterStrokeBox(layer, s) })).filter((o): o is { id: string; box: Box } => Boolean(o.box));
    // An image painted over: the image (id = layer id) and its strokes are sibling objects, image first (Illustrator).
    const box = layer.sourceAssetId ? layerBox(layer) : null;
    return box ? [{ id: layer.id, box }, ...strokes] : strokes;
  }
  if (layer.type === 'vector') {
    const mask = layer.pixelMask ? maskBounds(layer.pixelMask) : null;
    return [
    // Hidden shapes are no objects here: they never count in a box. Locked ones do (they are seen, and move with their group).
    ...shownLayer(layer).shapes.map((s) => ({ id: s.id, box: shapeBox(s) as Box | null })),
    ...(layer.strokes ?? []).map((s) => ({ id: s.id, box: strokeBox(s) })),
  ].map(o => {
    if (!layer.pixelMask || !o.box) return o;
    if (!mask) return { ...o, box: null };
    const x = Math.max(o.box.x, mask.x), y = Math.max(o.box.y, mask.y);
    const w = Math.min(o.box.x + o.box.w, mask.x + mask.w) - x, h = Math.min(o.box.y + o.box.h, mask.y + mask.h) - y;
    return { ...o, box: w > 0 && h > 0 ? { x, y, w, h } : null };
  }).filter((o): o is { id: string; box: Box } => Boolean(o.box));
  }
  return [];
}

/** The objects a click or a marquee may pick: not the locked shapes (nor the hidden, which are no objects). */
export function pickableObjects(layer: Layer): Array<{ id: string; box: Box }> {
  const objs = layerObjects(layer);
  if (layer.type !== 'vector') return objs;
  const off = new Set(layer.shapes.filter((s) => !pickable(layer, s)).map((s) => s.id));
  return off.size ? objs.filter((o) => !off.has(o.id)) : objs;
}

/** Ids a pick of this layer may hold: its objects, plus every shape (a picked group carries its hidden members). */
export function pickIds(layer: Layer): Set<string> {
  return new Set([...layerObjects(layer).map((o) => o.id), ...(layer.type === 'vector' ? layer.shapes.map((s) => s.id) : [])]);
}

/** The topmost object of the layer under a point. */
export function objectAt(layer: Layer, x: number, y: number): string | null {
  if (layer.type === 'raster' && wholeLayerObject(layer)) return hitTestPixel({ layers: [layer] } as DesignDoc, x, y)?.id ?? null;
  if (layer.type === 'raster' && layer.sourceAssetId) {
    // A stroke on top wins; elsewhere on the image's pixels, the image.
    const strokes = layerObjects(layer).slice(1);
    for (let i = strokes.length - 1; i >= 0; i--) { const b = strokes[i].box; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return strokes[i].id; }
    return hitTestPixel({ layers: [layer] } as DesignDoc, x, y)?.id ?? null;
  }
  if (layer.type === 'vector' && !maskContains(layer, x, y)) return null;
  const objs = pickableObjects(layer);
  for (let i = objs.length - 1; i >= 0; i--) {
    const b = objs[i].box;
    if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
    if (layer.type === 'vector' && !vectorObjectHit(layer, objs[i].id, x, y)) continue;
    return objs[i].id;
  }
  return null;
}

export function objectsBox(layer: Layer, ids: string[]): Box | null {
  return union(layerObjects(layer).filter((o) => ids.includes(o.id)).map((o) => o.box));
}

/** Move some objects of a layer (pure; a painted layer still needs `composeRaster`). */
export function translateObjects(layer: Layer, ids: string[], dx: number, dy: number): Layer {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return layer;
  if ((wholeLayerObject(layer) || layer.type === 'raster') && ids.includes(layer.id)) return translateLayer(layer, dx, dy);
  if (layer.type === 'raster') return ids.reduce((l, id) => moveRasterStroke(l, id, dx, dy), layer as RasterLayer);
  if (layer.type === 'vector' && layer.pixelMask && allVectorObjects(layer, ids)) return translateLayer(layer, dx, dy);
  if (layer.type === 'vector') return {
    ...layer,
    shapes: layer.shapes.map((s) => (ids.includes(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)),
    ...(layer.strokes ? { strokes: layer.strokes.map((s) => (ids.includes(s.id) ? shiftStroke(s, dx, dy) : s)) } : {}),
  };
  return layer;
}

/** Flip or turn some objects about the center of their joint box (pure). */
export function turnObjects(layer: Layer, ids: string[], turn: Turn): Layer {
  const box = objectsBox(layer, ids);
  if (!box) return layer;
  if ((wholeLayerObject(layer) || layer.type === 'raster') && ids.includes(layer.id) && layer.type !== 'vector' && layer.type !== 'fx') {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const m = turn === 'flip-h' ? scaleAbout(-1, 1, cx, cy) : turn === 'flip-v' ? scaleAbout(1, -1, cx, cy)
      : rotateAbout(turn === 'rotate-cw' ? Math.PI / 2 : turn === 'rotate-ccw' ? -Math.PI / 2 : Math.PI, cx, cy);
    return { ...layer, transform: multiply(m, layer.transform ?? [1, 0, 0, 1, 0, 0]) };
  }
  if (layer.type === 'vector') {
    if (layer.pixelMask && allVectorObjects(layer, ids)) return turnVector(layer, turn);
    // The picked objects alone, as a layer: turned about their own joint center, then put back in place.
    const part: VectorLayer = { ...layer, shapes: layer.shapes.filter((s) => ids.includes(s.id)), strokes: (layer.strokes ?? []).filter((s) => ids.includes(s.id)) };
    const turned = turnVector(part, turn);
    const byId = new Map<string, unknown>([...turned.shapes.map((s) => [s.id, s] as const), ...(turned.strokes ?? []).map((s) => [s.id, s] as const)]);
    return {
      ...layer,
      shapes: layer.shapes.map((s) => (byId.get(s.id) as typeof s) ?? s),
      ...(layer.strokes ? { strokes: layer.strokes.map((s) => (byId.get(s.id) as typeof s) ?? s) } : {}),
    };
  }
  if (layer.type === 'raster') {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const pageTurn = turn === 'flip-h' ? scaleAbout(-1, 1, cx, cy) : turn === 'flip-v' ? scaleAbout(1, -1, cx, cy)
      : rotateAbout(turn === 'rotate-cw' ? Math.PI / 2 : turn === 'rotate-ccw' ? -Math.PI / 2 : Math.PI, cx, cy);
    const bufferToPage = multiply(layer.transform ?? IDENTITY, [layer.width / layer.pxWidth, 0, 0, layer.height / layer.pxHeight, layer.x, layer.y] as Mat);
    const bufferTurn = multiply(invert(bufferToPage), multiply(pageTurn, bufferToPage));
    const f = (x: number, y: number) => apply(bufferTurn, x, y);
    return {
      ...layer,
      paintStrokes: layer.paintStrokes?.map((s) => {
        if (!ids.includes(s.id)) return s;
        const segments = s.segments.map(([ax, ay, bx, by, w]) => {
          const [a0, a1] = f(ax + s.x, ay + s.y), [b0, b1] = f(bx + s.x, by + s.y);
          return [a0, a1, b0, b1, w] as [number, number, number, number, number];
        });
        return { ...s, x: 0, y: 0, segments };
      }),
    };
  }
  return layer;
}

/** How far each picked object moves to line up with the chosen reference. */
/** Align picked objects, or preserve their spacing while moving them as one group. */
export function alignObjectDeltas(doc: Pick<DesignDoc, 'width' | 'height'>, layer: Layer, ids: string[], to: AlignTo, rel: RelativeTo, asGroup = false): Map<string, { dx: number; dy: number }> {
  const byId = new Map(layerObjects(layer).map((o) => [o.id, o]));
  return alignBoxes(doc, ids.map((id) => byId.get(id)).filter((o): o is { id: string; box: Box } => Boolean(o)), to, rel, asGroup);
}

/** The same for boxes that may come from several layers (the ids must be unique among them). */
export function alignBoxes(doc: Pick<DesignDoc, 'width' | 'height'>, objs: Array<{ id: string; box: Box }>, to: AlignTo, rel: RelativeTo, asGroup = false): Map<string, { dx: number; dy: number }> {
  const out = new Map<string, { dx: number; dy: number }>();
  if (!objs.length) return out;
  const boxes = objs.map((o) => o.box);
  const biggest = () => [...objs].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  const smallest = () => [...objs].sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];
  const anchor = rel === 'first' ? objs[0] : rel === 'last' ? objs[objs.length - 1] : rel === 'biggest' ? biggest() : rel === 'smallest' ? smallest() : null;
  const ref: Box | null = rel === 'page' ? { x: 0, y: 0, w: doc.width, h: doc.height }
    : anchor?.box ?? unionBoxes(boxes);
  if (!ref) return out;
  if (asGroup && rel === 'selection') return out;
  const moving = asGroup && anchor ? objs.filter((o) => o.id !== anchor.id) : objs;
  if (asGroup) {
    const groupBox = unionBoxes(moving.map((o) => o.box));
    if (!groupBox) return out;
    const delta = alignBoxDelta(groupBox, ref, to);
    if (delta.dx || delta.dy) for (const o of moving) out.set(o.id, delta);
    return out;
  }
  for (const o of moving) {
    if (anchor && o.id === anchor.id) continue;
    const delta = alignBoxDelta(o.box, ref, to);
    if (delta.dx || delta.dy) out.set(o.id, delta);
  }
  return out;
}

/** Even gaps between 3+ picked objects, within their original span. */
export function distributeObjectDeltas(layer: Layer, ids: string[], axis: 'h' | 'v'): Map<string, { dx: number; dy: number }> {
  return distributeBoxes(layerObjects(layer).filter((o) => ids.includes(o.id)), axis);
}

/** The same for boxes that may come from several layers (the ids must be unique among them). */
export function distributeBoxes(items: Array<{ id: string; box: Box }>, axis: 'h' | 'v'): Map<string, { dx: number; dy: number }> {
  const out = new Map<string, { dx: number; dy: number }>();
  if (items.length < 3) return out;
  const h = axis === 'h';
  items.sort((a, z) => (h ? a.box.x - z.box.x : a.box.y - z.box.y));
  const first = items[0].box;
  const span = Math.max(...items.map(({ box }) => h ? box.x + box.w : box.y + box.h)) - (h ? first.x : first.y);
  const used = items.reduce((n, i) => n + (h ? i.box.w : i.box.h), 0);
  const gap = (span - used) / (items.length - 1);
  let at = h ? first.x : first.y;
  for (const i of items) {
    const d = at - (h ? i.box.x : i.box.y);
    if (d) out.set(i.id, h ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    at += (h ? i.box.w : i.box.h) + gap;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Applied to the document (one undo step each)

const docOf = (sessionId: string, docId: string) => useStore.getState().sessions[sessionId]?.docs.find((d) => d.id === docId);

/** Replace the layer; a painted layer is recomposed from its base and strokes (they stay editable). */
export function commitObjects(sessionId: string, docId: string, next: Layer, recordFirst = true): void {
  commitLayers(sessionId, docId, [next], recordFirst);
}

/** Replace several layers in one undo step (objects picked in more than one layer); nothing changes if one is locked or not ready. */
export function commitLayers(sessionId: string, docId: string, nexts: Layer[], recordFirst = true): void {
  const doc = docOf(sessionId, docId);
  if (!doc || !nexts.length) return;
  const locked = nexts.find((n) => n.locked);
  if (locked) return void toast(`"${locked.name}" is locked.`, 'error');
  for (const next of nexts) if (next.type === 'raster' && !wholeLayerObject(doc.layers.find((l) => l.id === next.id) ?? next) && !composeRaster(next)) return void toast(pixelsNotReady([next.id, next.paintBaseId]), 'error');
  if (recordFirst) record(doc);
  const by = new Map(nexts.map((n) => [n.id, n.type === 'raster' ? { ...n, rev: n.rev + 1 } : n] as const));
  setDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => by.get(l.id) ?? l) }));
}

function picked(sessionId: string, docId: string, layerId: string): Layer | null {
  return docOf(sessionId, docId)?.layers.find((l) => l.id === layerId) ?? null;
}

export function turnPickedObjects(sessionId: string, docId: string, layerId: string, ids: string[], turn: Turn): void {
  const l = picked(sessionId, docId, layerId);
  if (!l) return;
  const next = turnObjects(l, ids, turn);
  commitObjects(sessionId, docId, next);
  if (looksUnchanged(l, next, ids)) toast(noChangeNote(ids.length === 1 && l.type === 'vector' ? l.name : 'the selection', turn), 'info', 5000);
}

export function moveEach(layer: Layer, deltas: Map<string, { dx: number; dy: number }>): Layer {
  let out = layer;
  for (const [id, m] of deltas) out = translateObjects(out, [id], m.dx, m.dy);
  return out;
}

export function alignPickedObjects(sessionId: string, docId: string, layerId: string, ids: string[], to: AlignTo, rel: RelativeTo, asGroup = false): void {
  const doc = docOf(sessionId, docId), l = picked(sessionId, docId, layerId);
  if (!doc || !l) return;
  const deltas = alignObjectDeltas(doc, l, ids, to, rel, asGroup);
  if (deltas.size) commitObjects(sessionId, docId, moveEach(l, deltas));
}

export function distributePickedObjects(sessionId: string, docId: string, layerId: string, ids: string[], axis: 'h' | 'v'): void {
  const l = picked(sessionId, docId, layerId);
  if (!l) return;
  const deltas = distributeObjectDeltas(l, ids, axis);
  if (deltas.size) commitObjects(sessionId, docId, moveEach(l, deltas));
}

/** Delete the picked objects of a layer (painted strokes, shapes, Lineart strokes); the rest stays editable. One undo step. */
export function deletePickedObjects(sessionId: string, docId: string, layerId: string, ids: string[]): void {
  const l = picked(sessionId, docId, layerId);
  if (!l || !ids.length) return;
  const next = withoutObjects(l, ids);
  if (next === l) return;
  commitObjects(sessionId, docId, next);
}

/** The layer without those objects (pure; the same layer when it has none of them). */
export function withoutObjects(l: Layer, ids: readonly string[]): Layer {
  const gone = new Set(ids);
  if (l.type === 'raster' && !(l.paintStrokes ?? []).some((s) => gone.has(s.id))) return l;
  if (l.type === 'vector' && !l.shapes.some((s) => gone.has(s.id)) && !(l.strokes ?? []).some((s) => gone.has(s.id))) return l;
  return l.type === 'raster'
    ? { ...l, paintStrokes: (l.paintStrokes ?? []).filter((s) => !gone.has(s.id)) }
    : l.type === 'vector'
      ? { ...l, shapes: l.shapes.filter((s) => !gone.has(s.id)), ...(l.strokes ? { strokes: l.strokes.filter((s) => !gone.has(s.id)) } : {}) }
      : l;
}
