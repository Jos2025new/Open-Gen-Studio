import type { DesignDoc, Layer, RasterLayer } from '../types';

/*
 * Drawing or Design (ADR 0016). Drawing: a brush stroke goes straight into the layer's pixels, as in Krita, GIMP or
 * Photoshop, and no stroke limit applies. Design: strokes stay editable up to the limit, then the layer flattens
 * (the behavior before the choice existed). A document with no saved choice opens in Design when a layer already has
 * editable strokes, and in Drawing otherwise. Nothing is rewritten on read.
 */

export type PaintMode = 'drawing' | 'design';

/** The mode the document is in: its saved choice, or the default for documents that never had one. */
export function paintModeOf(doc: Pick<DesignDoc, 'paintMode' | 'layers'>): PaintMode {
  if (doc.paintMode) return doc.paintMode;
  // Editable strokes: Design. Vector shapes only, or no painted raster content: Design (ADR 0016, amendment 2026-10-14).
  // A raster layer with painted pixels: Drawing.
  if (doc.layers.some((l) => hasEditableStrokes(l))) return 'design';
  return doc.layers.some((l) => hasPaintedPixels(l)) ? 'drawing' : 'design';
}

/**
 * The document with its mode fixed (ADR 0016, amendment 2026-10-14): a saved choice stays; one with none gets the mode
 * it deduces now, so painting the first pixel or adding a shape later cannot change it. Same object when nothing is missing.
 */
export function pinPaintMode<T extends Pick<DesignDoc, 'paintMode' | 'layers'>>(doc: T): T {
  return doc.paintMode ? doc : { ...doc, paintMode: paintModeOf(doc) };
}

/** A raster layer that holds painted pixels or an imported image (not counted: an empty layer). */
export function hasPaintedPixels(layer: Layer | null | undefined): boolean {
  return !!layer && layer.type === 'raster' && !!(layer.sourceAssetId || layer.paintBaseId || (layer.paintStrokes?.length ?? 0) > 0);
}

/** A raster layer whose strokes are still kept as editable entries (not flattened into its pixels). */
export function hasEditableStrokes(layer: Layer | null | undefined): boolean {
  return !!layer && layer.type === 'raster' && !layer.paintFlattened && (layer.paintStrokes?.length ?? 0) > 0;
}

/** A stroke on this layer goes into its pixels (no entry is recorded): Drawing, and no editable strokes to keep in order. */
export function paintsPixelsDirectly(doc: Pick<DesignDoc, 'paintMode' | 'layers'>, layer: RasterLayer): boolean {
  return paintModeOf(doc) === 'drawing' && !hasEditableStrokes(layer);
}

/** Selecting and moving single strokes is offered in Design, or on a raster layer that already has editable strokes. */
export function strokeObjectsAvailable(doc: Pick<DesignDoc, 'paintMode' | 'layers' | 'activeLayerId'>): boolean {
  const active = doc.layers.find((l) => l.id === doc.activeLayerId);
  return !(active?.type === 'raster' && paintModeOf(doc) === 'drawing' && !hasEditableStrokes(active));
}
