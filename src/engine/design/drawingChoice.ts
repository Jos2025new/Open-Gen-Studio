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
let pendingPoint: { x: number; y: number } | null = null;
let closedAt = 0;
/** `at`: the pointer position (screen px) where the stroke was pressed; the prompt opens beside it. */
export function requestDrawingChoice(layerId: string, at?: { x: number; y: number }): void {
  pendingLayer = layerId;
  pendingPoint = at ?? null;
  notifyChoice();
}
export const pendingChoicePoint = (): { x: number; y: number } | null => pendingPoint;
/** Closing the prompt without a choice (Escape, a click outside): nothing changes and nothing is painted. */
export function cancelDrawingChoice(): void {
  if (pendingLayer === null) return;
  pendingLayer = null;
  pendingPoint = null;
  closedAt = Date.now();
  notifyChoice();
}
/** The press that closed the prompt is the same click: it must not open the prompt again. */
export function justClosedChoice(): boolean {
  return Date.now() - closedAt < 400;
}
/**
 * Where the prompt's anchor goes: 12 px from the press, toward the bottom-right, and flipped or clamped so a box of
 * `box` size stays inside the view `view`.
 */
export function promptAnchor(p: { x: number; y: number }, view: { w: number; h: number }, box: { w: number; h: number }): { x: number; y: number } {
  const off = 12;
  let x = p.x + off, y = p.y + off;
  if (x + box.w > view.w) x = p.x - off - box.w;
  if (y + box.h > view.h) y = p.y - off - box.h;
  return { x: Math.min(Math.max(0, x), Math.max(0, view.w - box.w)), y: Math.min(Math.max(0, y), Math.max(0, view.h - box.h)) };
}

/** The layer (in this document) that the prompt is about, if it still needs one. */
export function pendingChoiceIn(doc: DesignDoc): RasterLayer | null {
  return doc.layers.find((l): l is RasterLayer => l.id === pendingLayer && l.type === 'raster') ?? null;
}
