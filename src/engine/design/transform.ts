import { mapPathShape } from './path';
import { looksUnchanged, noChangeNote } from './symmetry';
import type { DesignDoc, Layer, VectorLayer, VectorShape } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { setDoc, toast, useStore } from '../../store/store';
import * as D from './doc';
import { record } from './history';
import { getBuffer, setBuffer } from './raster';
import { layerBox } from './render';

/*
 * Edit tool operations on the active layer: align to the page, fit or fill it, flip and rotate by quarter turns.
 * Raster layers turn their pixels (painted strokes are merged into the image); vector layers turn their shapes and
 * strokes; text can be aligned but not flipped or rotated (no rotation in the layer model). Each is one undo step.
 */

export type AlignTo = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Turn = 'flip-h' | 'flip-v' | 'rotate-cw' | 'rotate-ccw' | 'rotate-180';

const get = () => useStore.getState();
const docOf = (sessionId: string, docId: string) => get().sessions[sessionId]?.docs.find((d) => d.id === docId);

/** Why the layer cannot take this operation, or null. */
export function turnProblem(layer: Layer, _turn: Turn): string | null {
  if (layer.locked) return `"${layer.name}" is locked.`;
  if (layer.type === 'text') return 'Text layers cannot be flipped or rotated.';
  return null;
}

/** Where the layer goes to line up with the page edge or center. */
export function alignDelta(doc: Pick<DesignDoc, 'width' | 'height'>, layer: Layer, to: AlignTo): { dx: number; dy: number } {
  const b = layerBox(layer);
  if (!b) return { dx: 0, dy: 0 };
  const dx = to === 'left' ? -b.x : to === 'right' ? doc.width - (b.x + b.w) : to === 'center' ? doc.width / 2 - (b.x + b.w / 2) : 0;
  const dy = to === 'top' ? -b.y : to === 'bottom' ? doc.height - (b.y + b.h) : to === 'middle' ? doc.height / 2 - (b.y + b.h / 2) : 0;
  return { dx, dy };
}

/** A vector layer turned about its own center (pure: shapes and pressure strokes). */
export function turnVector(layer: VectorLayer, turn: Turn): VectorLayer {
  const b = layerBox(layer);
  if (!b) return layer;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  // Drawn paths (polygon, curve, arrow, the agent's paths) move their points, for every turn: exact, and no
  // negative sizes left behind.
  const pointFn = (x: number, y: number): [number, number] =>
    turn === 'flip-h' ? [2 * cx - x, y]
      : turn === 'flip-v' ? [x, 2 * cy - y]
        : turn === 'rotate-180' ? [2 * cx - x, 2 * cy - y]
          : turn === 'rotate-cw' ? [cx - (y - cy), cy + (x - cx)] : [cx + (y - cy), cy - (x - cx)];
  const withPaths = (l: VectorLayer): VectorLayer => ({ ...l, shapes: l.shapes.map((s, i) => (layer.shapes[i]?.type === 'path' ? mapPathShape(layer.shapes[i], pointFn) : s)) });
  if (turn === 'flip-h') return withPaths(D.scaleLayer(layer, -1, 1, cx, cy) as VectorLayer);
  if (turn === 'flip-v') return withPaths(D.scaleLayer(layer, 1, -1, cx, cy) as VectorLayer);
  if (turn === 'rotate-180') return withPaths(D.scaleLayer(layer, -1, -1, cx, cy) as VectorLayer);
  const cw = turn === 'rotate-cw';
  const rot = (x: number, y: number): [number, number] => (cw ? [cx - (y - cy), cy + (x - cx)] : [cx + (y - cy), cy - (x - cx)]);
  const shapes = layer.shapes.map((s): VectorShape => {
    if (s.type === 'path') return mapPathShape(s, pointFn);
    if (s.type === 'line') {
      const [x1, y1] = rot(s.x, s.y);
      const [x2, y2] = rot(s.x + s.w, s.y + s.h);
      return { ...s, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    // Rect and ellipse: the same box turned (its center moves, its sides swap).
    const [mx, my] = rot(s.x + s.w / 2, s.y + s.h / 2);
    return { ...s, x: mx - s.h / 2, y: my - s.w / 2, w: s.h, h: s.w };
  });
  const strokes = layer.strokes?.map((st) => ({ ...st, points: st.points.map(([x, y, p]) => [...rot(x, y), p] as [number, number, number]) }));
  return { ...layer, shapes, ...(strokes ? { strokes } : {}) };
}

/** Raster: the pixels turned, the layer box turned about its center; painted strokes are merged into the image. */
function turnRaster(sessionId: string, docId: string, layer: Extract<Layer, { type: 'raster' }>, turn: Turn): void {
  const src = getBuffer(layer.id);
  if (!src) return;
  const quarter = turn === 'rotate-cw' || turn === 'rotate-ccw';
  // A painted layer covers the whole page: turn what is painted about its own center, inside the same buffer.
  // (Turning the page-sized frame made the strokes jump to the other side of the page.) Images turn their frame.
  if (!layer.sourceAssetId) {
    const b = layerBox(layer);
    if (!b) return;
    const kx = src.width / layer.width, ky = src.height / layer.height;
    const cxp = (b.x + b.w / 2 - layer.x) * kx, cyp = (b.y + b.h / 2 - layer.y) * ky;
    const out = createCanvas(src.width, src.height);
    const c = ctx2d(out);
    c.translate(cxp, cyp);
    if (turn === 'flip-h') c.scale(-1, 1);
    else if (turn === 'flip-v') c.scale(1, -1);
    else c.rotate(turn === 'rotate-cw' ? Math.PI / 2 : turn === 'rotate-ccw' ? -Math.PI / 2 : Math.PI);
    c.translate(-cxp, -cyp);
    c.drawImage(src, 0, 0);
    setBuffer(layer.id, out);
    setDoc(sessionId, docId, (d) => D.updateLayer(d, layer.id, { paintBaseId: undefined, paintStrokes: undefined, rev: layer.rev + 1 }));
    return;
  }
  const out = createCanvas(quarter ? src.height : src.width, quarter ? src.width : src.height);
  const c = ctx2d(out);
  c.translate(out.width / 2, out.height / 2);
  if (turn === 'flip-h') c.scale(-1, 1);
  else if (turn === 'flip-v') c.scale(1, -1);
  else c.rotate(turn === 'rotate-cw' ? Math.PI / 2 : turn === 'rotate-ccw' ? -Math.PI / 2 : Math.PI);
  c.drawImage(src, -src.width / 2, -src.height / 2);
  setBuffer(layer.id, out);
  const cx = layer.x + layer.width / 2, cy = layer.y + layer.height / 2;
  const w = quarter ? layer.height : layer.width, h = quarter ? layer.width : layer.height;
  setDoc(sessionId, docId, (d) => D.updateLayer(d, layer.id, { x: cx - w / 2, y: cy - h / 2, width: w, height: h, pxWidth: out.width, pxHeight: out.height, paintBaseId: undefined, paintStrokes: undefined, rev: layer.rev + 1 }));
}

export function turnLayer(sessionId: string, docId: string, layerId: string, turn: Turn): void {
  const doc = docOf(sessionId, docId);
  const layer = doc?.layers.find((l) => l.id === layerId);
  if (!doc || !layer) return;
  const problem = turnProblem(layer, turn);
  if (problem) return void toast(problem, 'error');
  record(doc);
  if (layer.type === 'raster') turnRaster(sessionId, docId, layer, turn);
  else if (layer.type === 'vector') {
    const next = turnVector(layer, turn);
    setDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => (l.id === layerId ? next : l)) }));
    if (looksUnchanged(layer, next)) toast(noChangeNote(layer.name, turn), 'info', 5000);
  }
}

export function alignLayer(sessionId: string, docId: string, layerId: string, to: AlignTo): void {
  const doc = docOf(sessionId, docId);
  const layer = doc?.layers.find((l) => l.id === layerId);
  if (!doc || !layer) return;
  if (layer.locked) return void toast(`"${layer.name}" is locked.`, 'error');
  const { dx, dy } = alignDelta(doc, layer, to);
  if (!dx && !dy) return;
  record(doc);
  setDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => (l.id === layerId ? D.translateLayer(l, dx, dy) : l)) }));
}

/** An image fitted inside the page (contain) or covering it (fill), centered, keeping its proportions. */
export function fitLayer(sessionId: string, docId: string, layerId: string, mode: 'contain' | 'cover'): void {
  const doc = docOf(sessionId, docId);
  const layer = doc?.layers.find((l) => l.id === layerId);
  if (!doc || layer?.type !== 'raster') return;
  if (layer.locked) return void toast(`"${layer.name}" is locked.`, 'error');
  record(doc);
  setDoc(sessionId, docId, (d) => D.updateLayer(d, layerId, D.fitRect(d.width, d.height, layer.width, layer.height, mode)));
}

// ---------------------------------------------------------------------------
// Several layers

export type RelativeTo = 'page' | 'selection' | 'first' | 'last' | 'biggest' | 'smallest';
type Box = { x: number; y: number; w: number; h: number };

/** The box the layers line up against (Inkscape's "Relative to"). */
export function referenceBox(doc: Pick<DesignDoc, 'width' | 'height'>, layers: Layer[], rel: RelativeTo): Box | null {
  if (rel === 'page' || !layers.length) return { x: 0, y: 0, w: doc.width, h: doc.height };
  const boxes = layers.map((l) => layerBox(l)).filter((b): b is Box => Boolean(b));
  if (!boxes.length) return null;
  if (rel === 'first') return boxes[0];
  if (rel === 'last') return boxes[boxes.length - 1];
  if (rel === 'biggest' || rel === 'smallest') return [...boxes].sort((a, b) => (rel === 'biggest' ? b.w * b.h - a.w * a.h : a.w * a.h - b.w * b.h))[0];
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  return { x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0 };
}

/** How far each layer moves to line up with the reference box. */
export function alignDeltas(doc: Pick<DesignDoc, 'width' | 'height'>, layers: Layer[], to: AlignTo, rel: RelativeTo): Map<string, { dx: number; dy: number }> {
  const ref = referenceBox(doc, layers, rel);
  const out = new Map<string, { dx: number; dy: number }>();
  if (!ref) return out;
  for (const l of layers) {
    const b = layerBox(l);
    if (!b) continue;
    const dx = to === 'left' ? ref.x - b.x : to === 'right' ? ref.x + ref.w - (b.x + b.w) : to === 'center' ? ref.x + ref.w / 2 - (b.x + b.w / 2) : 0;
    const dy = to === 'top' ? ref.y - b.y : to === 'bottom' ? ref.y + ref.h - (b.y + b.h) : to === 'middle' ? ref.y + ref.h / 2 - (b.y + b.h / 2) : 0;
    if (dx || dy) out.set(l.id, { dx, dy });
  }
  return out;
}

/** Even gaps between 3+ layers, the outer two staying put. */
export function distributeDeltas(layers: Layer[], axis: 'h' | 'v'): Map<string, { dx: number; dy: number }> {
  const items = layers.map((l) => ({ l, b: layerBox(l) })).filter((x): x is { l: Layer; b: Box } => Boolean(x.b));
  const out = new Map<string, { dx: number; dy: number }>();
  if (items.length < 3) return out;
  const h = axis === 'h';
  items.sort((a, z) => (h ? a.b.x - z.b.x : a.b.y - z.b.y));
  const first = items[0].b, last = items[items.length - 1].b;
  const span = h ? last.x + last.w - first.x : last.y + last.h - first.y;
  const used = items.reduce((n, i) => n + (h ? i.b.w : i.b.h), 0);
  const gap = (span - used) / (items.length - 1);
  let at = h ? first.x : first.y;
  for (const i of items) {
    const d = at - (h ? i.b.x : i.b.y);
    if (d) out.set(i.l.id, h ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    at += (h ? i.b.w : i.b.h) + gap;
  }
  return out;
}

function moveLayers(sessionId: string, docId: string, deltas: Map<string, { dx: number; dy: number }>): void {
  const doc = docOf(sessionId, docId);
  if (!doc || !deltas.size) return;
  record(doc);
  setDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => { const m = deltas.get(l.id); return m ? D.translateLayer(l, m.dx, m.dy) : l; }) }));
}

const pick = (sessionId: string, docId: string, ids: string[]) => {
  const doc = docOf(sessionId, docId);
  const layers = ids.map((id) => doc?.layers.find((l) => l.id === id)).filter((l): l is Layer => Boolean(l));
  const locked = layers.find((l) => l.locked);
  if (locked) toast(`"${locked.name}" is locked.`, 'error');
  return { doc, layers: locked ? [] : layers };
};

/** Align several layers (or one) to the page, the selection, the first or last picked, or the biggest or smallest. */
export function alignLayers(sessionId: string, docId: string, ids: string[], to: AlignTo, rel: RelativeTo): void {
  const { doc, layers } = pick(sessionId, docId, ids);
  if (doc && layers.length) moveLayers(sessionId, docId, alignDeltas(doc, layers, to, layers.length === 1 ? 'page' : rel));
}

export function distributeLayers(sessionId: string, docId: string, ids: string[], axis: 'h' | 'v'): void {
  const { layers } = pick(sessionId, docId, ids);
  moveLayers(sessionId, docId, distributeDeltas(layers, axis));
}

/** Flip or turn each selected layer about its own center (one undo step). */
export function turnLayers(sessionId: string, docId: string, ids: string[], turn: Turn): void {
  const doc = docOf(sessionId, docId);
  if (!doc) return;
  const layers = ids.map((id) => doc.layers.find((l) => l.id === id)).filter((l): l is Layer => Boolean(l));
  const blocked = layers.map((l) => turnProblem(l, turn)).find(Boolean);
  if (blocked) return void toast(blocked, 'error');
  record(doc);
  for (const l of layers) {
    if (l.type === 'raster') turnRaster(sessionId, docId, docOf(sessionId, docId)!.layers.find((x) => x.id === l.id) as Extract<Layer, { type: 'raster' }>, turn);
    else if (l.type === 'vector') setDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((x) => (x.id === l.id && x.type === 'vector' ? turnVector(x, turn) : x)) }));
  }
  const still = layers.filter((l) => l.type === 'vector' && looksUnchanged(l, turnVector(l as VectorLayer, turn)));
  if (still.length === layers.length && still.length) toast(noChangeNote(still.length === 1 ? still[0].name : 'the picked layers', turn), 'info', 5000);
}
