import type { RasterLayer } from '../types';

/** Initial defaults, deliberately provisional until the fluency plan is measured end to end. */
export const DEFAULT_PAINT_STROKE_LIMIT = 64;
/** 64 strokes × about 128 segments; long strokes reach the same rough JSON/replay budget sooner. */
export const DEFAULT_PAINT_SEGMENT_LIMIT = 8192;
export const PAINT_LIMIT_EARLY_WARNING_RATIO = 0.8;

export interface RasterPaintLimits {
  strokes: number;
  segments: number;
}

export const DEFAULT_RASTER_PAINT_LIMITS: RasterPaintLimits = {
  strokes: DEFAULT_PAINT_STROKE_LIMIT,
  segments: DEFAULT_PAINT_SEGMENT_LIMIT,
};

export interface RasterPaintUsage {
  strokes: number;
  segments: number;
}

export function rasterPaintUsage(layer: RasterLayer): RasterPaintUsage {
  const strokes = layer.paintStrokes ?? [];
  return { strokes: strokes.length, segments: strokes.reduce((n, stroke) => n + stroke.segments.length, 0) };
}

/** Old documents are never changed on load. Painting an already-full editable layer asks first. */
export function requiresRasterPaintApproval(layer: RasterLayer, limits = DEFAULT_RASTER_PAINT_LIMITS): boolean {
  if (layer.paintFlattened || layer.paintLimitDisabled) return false;
  const usage = rasterPaintUsage(layer);
  return usage.strokes >= limits.strokes || usage.segments >= limits.segments;
}

/** The stroke already lives in the exact canvas Stage painted; commit this layer in pixel mode now. */
export function shouldFlattenRasterPaint(layer: RasterLayer, limits = DEFAULT_RASTER_PAINT_LIMITS): boolean {
  if (layer.paintFlattened || layer.paintLimitDisabled) return false;
  const usage = rasterPaintUsage(layer);
  return usage.strokes >= limits.strokes || usage.segments >= limits.segments;
}

export function rasterPaintNearLimit(layer: RasterLayer, limits = DEFAULT_RASTER_PAINT_LIMITS): boolean {
  if (layer.paintFlattened || layer.paintLimitDisabled) return false;
  const usage = rasterPaintUsage(layer);
  return usage.strokes >= limits.strokes * PAINT_LIMIT_EARLY_WARNING_RATIO || usage.segments >= limits.segments * PAINT_LIMIT_EARLY_WARNING_RATIO;
}

/* One-shot permission is UI state only: it is neither persisted nor recorded in document history. */
let pendingPaintLayerId: string | null = null;
const armedPaintLayerIds = new Set<string>();
let gateVersion = 0;
const gateListeners = new Set<() => void>();

function notifyGate(): void {
  gateVersion++;
  gateListeners.forEach((listener) => listener());
}

export function subscribeRasterPaintGate(listener: () => void): () => void {
  gateListeners.add(listener);
  return () => gateListeners.delete(listener);
}

export function rasterPaintGateVersion(): number {
  return gateVersion;
}

export function pendingRasterPaintLayer(): string | null {
  return pendingPaintLayerId;
}

export function requestRasterPaintApproval(layerId: string): void {
  if (pendingPaintLayerId === layerId) return;
  pendingPaintLayerId = layerId;
  notifyGate();
}

export function cancelRasterPaintApproval(layerId: string): void {
  if (pendingPaintLayerId !== layerId) return;
  pendingPaintLayerId = null;
  notifyGate();
}

export function armNextRasterPaint(layerId: string): void {
  if (pendingPaintLayerId === layerId) pendingPaintLayerId = null;
  armedPaintLayerIds.add(layerId);
  notifyGate();
}

export function consumeRasterPaintApproval(layerId: string): boolean {
  if (!armedPaintLayerIds.delete(layerId)) return false;
  notifyGate();
  return true;
}
