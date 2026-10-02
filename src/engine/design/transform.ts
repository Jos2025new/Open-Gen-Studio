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
export function turnProblem(layer: Layer, turn: Turn): string | null {
  if (layer.locked) return `"${layer.name}" is locked.`;
  if (layer.type === 'text') return 'Text layers cannot be flipped or rotated.';
  if (layer.type === 'vector' && (turn === 'rotate-cw' || turn === 'rotate-ccw') && layer.shapes.some((s) => s.type === 'path')) return 'Drawn paths cannot turn a quarter: flip them or rotate 180° instead.';
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
  if (turn === 'flip-h') return D.scaleLayer(layer, -1, 1, cx, cy) as VectorLayer;
  if (turn === 'flip-v') return D.scaleLayer(layer, 1, -1, cx, cy) as VectorLayer;
  if (turn === 'rotate-180') return D.scaleLayer(layer, -1, -1, cx, cy) as VectorLayer;
  const cw = turn === 'rotate-cw';
  const rot = (x: number, y: number): [number, number] => (cw ? [cx - (y - cy), cy + (x - cx)] : [cx + (y - cy), cy - (x - cx)]);
  const shapes = layer.shapes.map((s): VectorShape => {
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
  else if (layer.type === 'vector') setDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => (l.id === layerId && l.type === 'vector' ? turnVector(l, turn) : l)) }));
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
