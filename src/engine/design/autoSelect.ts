import type { DesignDoc, Layer } from '../types';
import { hitTestPixel } from './render';

/*
 * What a click on the canvas acts on (Photoshop's Auto-select). Off (the default): the active layer, and only when the
 * click lands on its content; a click elsewhere keeps the selection. On: the topmost layer under the pointer.
 */
export function clickCandidate(autoSelect: boolean, topmost: Layer | null, active: Layer | undefined, hitsActive: (l: Layer) => boolean): Layer | null {
  if (autoSelect) return topmost;
  return active && hitsActive(active) ? active : null;
}

/**
 * Edit tool, Objects mode: the layer whose painted pixels (alpha) are under the pointer, for baked drawings with no
 * objects. Auto-select on: the topmost one; off: only the active layer. Hidden and locked layers are never a target.
 */
export function pixelTarget(doc: DesignDoc, x: number, y: number, autoSelect: boolean): Layer | null {
  if (autoSelect) { const h = hitTestPixel(doc, x, y); return h && h.visible && !h.locked ? h : null; }
  const a = doc.layers.find((l) => l.id === doc.activeLayerId);
  return a && a.visible && !a.locked && hitTestPixel({ ...doc, layers: [a] }, x, y) ? a : null;
}
