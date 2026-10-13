import type { DesignDoc, RasterLayer } from '../types';
import { createCanvas } from '../../lib/media';
import { record } from './history';
import { getDoc, setActiveLayer } from './actions';
import * as D from './doc';
import { setBuffer } from './raster';
import { setDoc, setUi, useStore } from '../../store/store';

/*
 * Painting in Drawing on a layer that still has editable strokes (ADR 0016, decision 2026-10-13). The stroke is refused,
 * the user picks one action; «Don't show again» saves the action as the preference, applied without asking. Closing the
 * prompt does nothing. Each action is one undo step (record) and is named by its toast.
 */

export type DrawingChoice = 'flatten' | 'design' | 'newLayer';
export type DrawingPreference = 'ask' | DrawingChoice;

/** The preference the user saved, or 'ask' (the default). */
export function drawingPreference(): DrawingPreference {
  return useStore.getState().ui.drawingChoice ?? 'ask';
}

/** Save the preference (Settings → «Ask every time» resets it). */
export function setDrawingPreference(value: DrawingPreference): void {
  setUi({ drawingChoice: value });
}

/** Apply one action to the layer; returns the message the toast shows. Nothing changes for an unknown layer. */
export function applyDrawingChoice(sessionId: string, docId: string, layerId: string, choice: DrawingChoice): string | null {
  const doc = getDoc(sessionId, docId);
  const layer = doc?.layers.find((l): l is RasterLayer => l.id === layerId && l.type === 'raster');
  if (!doc || !layer) return null;
  record(doc);
  if (choice === 'design') {
    setDoc(sessionId, docId, (d) => ({ ...d, paintMode: 'design', updatedAt: Date.now() }));
    return 'Design mode: the next stroke is editable up to the limit';
  }
  if (choice === 'flatten') {
    const count = layer.paintStrokes?.length ?? 0;
    setDoc(sessionId, docId, (d) => ({
      ...d,
      updatedAt: Date.now(),
      layers: d.layers.map((l) => (l.id === layerId && l.type === 'raster' ? { ...l, rev: l.rev + 1, paintFlattened: true, paintBaseId: undefined, paintStrokes: undefined } : l)),
    }));
    return `Flattened ${count} stroke${count === 1 ? '' : 's'} · Undo`;
  }
  // A new raster layer right above, selected, with the document's size.
  const n = doc.layers.filter((l) => l.type === 'raster' && !l.sourceAssetId).length + 1;
  const created = D.newRasterLayer(`Paint ${n}`, { x: 0, y: 0, width: doc.width, height: doc.height }, { width: doc.width, height: doc.height });
  setBuffer(created.id, createCanvas(doc.width, doc.height));
  setDoc(sessionId, docId, (d) => D.insertLayer(d, created, 'above'));
  setActiveLayer(sessionId, docId, created.id);
  return `Painting on a new layer: ${created.name} · Undo`;
}

/* The prompt: one layer at a time, shown beside the layer list (like the paint limit prompt). */
let pendingLayer: string | null = null;
const listeners = new Set<() => void>();
const notifyChoice = () => listeners.forEach((fn) => fn());
export function subscribeDrawingChoice(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const pendingDrawingChoiceLayer = (): string | null => pendingLayer;
export function requestDrawingChoice(layerId: string): void {
  pendingLayer = layerId;
  notifyChoice();
}
/** Closing the prompt without a choice: nothing changes and the stroke is not painted. */
export function cancelDrawingChoice(): void {
  if (pendingLayer === null) return;
  pendingLayer = null;
  notifyChoice();
}

/** The layer (in this document) that the prompt is about, if it still needs one. */
export function pendingChoiceIn(doc: DesignDoc): RasterLayer | null {
  return doc.layers.find((l): l is RasterLayer => l.id === pendingLayer && l.type === 'raster') ?? null;
}
