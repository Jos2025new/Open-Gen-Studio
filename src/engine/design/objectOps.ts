import { allVectorObjects, maskBounds, maskContains } from './vectorMask';
import type { DesignDoc, Layer, RasterLayer, VectorLayer } from '../types';
import { setDoc, toast, useStore } from '../../store/store';
import { record } from './history';
import { shapeBox, translateLayer } from './doc';
import { looksUnchanged, noChangeNote } from './symmetry';
import { strokeBox, translateStroke } from './strokes';
import { moveRasterStroke, rasterStrokeBox } from './rasterStrokes';
import { composeRaster } from './raster';
import { turnVector, type AlignTo, type RelativeTo, type Turn } from './transform';

/*
 * Edit in Objects mode: the operations act on the objects picked inside the active layer (objectSelection.ts), and
 * leave the layer and its other objects alone. Painted strokes stay editable (the layer is recomposed from its base
 * and strokes, never flattened). One undo step each.
 */

type Box = { x: number; y: number; w: number; h: number };
const union = (bs: Box[]): Box | null => {
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
};

/** The objects of a layer that can be picked, with their boxes (page coordinates). */
export function layerObjects(layer: Layer): Array<{ id: string; box: Box }> {
  if (layer.type === 'raster') return (layer.paintStrokes ?? []).filter((s) => !s.erase).map((s) => ({ id: s.id, box: rasterStrokeBox(layer, s) })).filter((o): o is { id: string; box: Box } => Boolean(o.box));
  if (layer.type === 'vector') {
    const mask = layer.pixelMask ? maskBounds(layer.pixelMask) : null;
    return [
    ...layer.shapes.map((s) => ({ id: s.id, box: shapeBox(s) as Box | null })),
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

/** The topmost object of the layer under a point. */
export function objectAt(layer: Layer, x: number, y: number): string | null {
  if (layer.type === 'vector' && !maskContains(layer, x, y)) return null;
  const objs = layerObjects(layer);
  for (let i = objs.length - 1; i >= 0; i--) {
    const b = objs[i].box;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return objs[i].id;
  }
  return null;
}

export function objectsBox(layer: Layer, ids: string[]): Box | null {
  return union(layerObjects(layer).filter((o) => ids.includes(o.id)).map((o) => o.box));
}

/** Move some objects of a layer (pure; a painted layer still needs `composeRaster`). */
export function translateObjects(layer: Layer, ids: string[], dx: number, dy: number): Layer {
  if (!dx && !dy) return layer;
  if (layer.type === 'raster') return ids.reduce((l, id) => moveRasterStroke(l, id, dx, dy), layer as RasterLayer);
  if (layer.type === 'vector' && layer.pixelMask && allVectorObjects(layer, ids)) return translateLayer(layer, dx, dy);
  if (layer.type === 'vector') return {
    ...layer,
    shapes: layer.shapes.map((s) => (ids.includes(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)),
    ...(layer.strokes ? { strokes: layer.strokes.map((s) => (ids.includes(s.id) ? translateStroke(s, dx, dy) : s)) } : {}),
  };
  return layer;
}

/** Flip or turn some objects about the center of their joint box (pure). */
export function turnObjects(layer: Layer, ids: string[], turn: Turn): Layer {
  const box = objectsBox(layer, ids);
  if (!box) return layer;
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
    // In buffer pixels: the strokes' points move; each stroke keeps its color, width and opacity.
    const kx = layer.pxWidth / layer.width, ky = layer.pxHeight / layer.height;
    const cx = (box.x + box.w / 2 - layer.x) * kx, cy = (box.y + box.h / 2 - layer.y) * ky;
    const f = (x: number, y: number): [number, number] =>
      turn === 'flip-h' ? [2 * cx - x, y]
        : turn === 'flip-v' ? [x, 2 * cy - y]
          : turn === 'rotate-180' ? [2 * cx - x, 2 * cy - y]
            : turn === 'rotate-cw' ? [cx - (y - cy), cy + (x - cx)] : [cx + (y - cy), cy - (x - cx)];
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
export function alignObjectDeltas(doc: Pick<DesignDoc, 'width' | 'height'>, layer: Layer, ids: string[], to: AlignTo, rel: RelativeTo): Map<string, { dx: number; dy: number }> {
  const objs = layerObjects(layer).filter((o) => ids.includes(o.id));
  const out = new Map<string, { dx: number; dy: number }>();
  if (!objs.length) return out;
  const boxes = objs.map((o) => o.box);
  const ref: Box | null = rel === 'page' ? { x: 0, y: 0, w: doc.width, h: doc.height }
    : rel === 'first' ? boxes[0] : rel === 'last' ? boxes[boxes.length - 1]
      : rel === 'biggest' || rel === 'smallest' ? [...boxes].sort((a, b) => (rel === 'biggest' ? b.w * b.h - a.w * a.h : a.w * a.h - b.w * b.h))[0]
        : union(boxes);
  if (!ref) return out;
  for (const o of objs) {
    const b = o.box;
    const dx = to === 'left' ? ref.x - b.x : to === 'right' ? ref.x + ref.w - (b.x + b.w) : to === 'center' ? ref.x + ref.w / 2 - (b.x + b.w / 2) : 0;
    const dy = to === 'top' ? ref.y - b.y : to === 'bottom' ? ref.y + ref.h - (b.y + b.h) : to === 'middle' ? ref.y + ref.h / 2 - (b.y + b.h / 2) : 0;
    if (dx || dy) out.set(o.id, { dx, dy });
  }
  return out;
}

/** Even gaps between 3+ picked objects, the outer two staying put. */
export function distributeObjectDeltas(layer: Layer, ids: string[], axis: 'h' | 'v'): Map<string, { dx: number; dy: number }> {
  const items = layerObjects(layer).filter((o) => ids.includes(o.id));
  const out = new Map<string, { dx: number; dy: number }>();
  if (items.length < 3) return out;
  const h = axis === 'h';
  items.sort((a, z) => (h ? a.box.x - z.box.x : a.box.y - z.box.y));
  const first = items[0].box, last = items[items.length - 1].box;
  const span = h ? last.x + last.w - first.x : last.y + last.h - first.y;
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
  const doc = docOf(sessionId, docId);
  if (!doc) return;
  if (next.locked) return void toast(`"${next.name}" is locked.`, 'error');
  if (next.type === 'raster' && !composeRaster(next)) return void toast('Layer pixels are still loading. Try again in a moment.', 'error');
  if (recordFirst) record(doc);
  setDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => (l.id === next.id ? (next.type === 'raster' ? { ...next, rev: next.rev + 1 } : next) : l)) }));
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

function moveEach(layer: Layer, deltas: Map<string, { dx: number; dy: number }>): Layer {
  let out = layer;
  for (const [id, m] of deltas) out = translateObjects(out, [id], m.dx, m.dy);
  return out;
}

export function alignPickedObjects(sessionId: string, docId: string, layerId: string, ids: string[], to: AlignTo, rel: RelativeTo): void {
  const doc = docOf(sessionId, docId), l = picked(sessionId, docId, layerId);
  if (!doc || !l) return;
  const deltas = alignObjectDeltas(doc, l, ids, to, rel);
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
  const gone = new Set(ids);
  const next: Layer = l.type === 'raster'
    ? { ...l, paintStrokes: (l.paintStrokes ?? []).filter((s) => !gone.has(s.id)) }
    : l.type === 'vector'
      ? { ...l, shapes: l.shapes.filter((s) => !gone.has(s.id)), ...(l.strokes ? { strokes: l.strokes.filter((s) => !gone.has(s.id)) } : {}) }
      : l;
  if (next === l) return;
  commitObjects(sessionId, docId, next);
}
