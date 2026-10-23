import type { DesignDoc, Layer, RasterLayer, RasterStroke } from '../../engine/types';
import type { LiveStroke } from '../../engine/design/raster';
import { commitEdit, getRasterSurface } from '../../engine/design/raster';
import { activeLayer } from '../../engine/design/doc';
import { isProtectedImage } from '../../engine/design/rules';
import { endBrushStroke } from '../../engine/design/brushStroke';
import { getDoc } from '../../engine/design/actions';
import { consumeRasterPaintApproval, requestRasterPaintApproval, requiresRasterPaintApproval, shouldFlattenRasterPaint } from '../../engine/design/rasterLimit';
import type { RasterPaintLimits } from '../../engine/design/rasterLimit';
import { setObjectPick } from '../../engine/design/objectSelection';
import type { BrushOptions } from '../../engine/design/brushEngine';
import { setDoc, toast } from '../../store/store';
import { applyDrawingChoice, drawingPreference, justClosedChoice, requestDrawingChoice } from '../../engine/design/drawingChoice';
import { hasEditableStrokes, paintModeOf } from '../../engine/design/paintMode';

/** The raster layer a brush stroke would land on (the active one, or the one above it), or null. */
export function paintCandidate(doc: DesignDoc, erase: boolean): RasterLayer | null {
  const selected = activeLayer(doc);
  const paintable = (item: Layer | null | undefined): item is RasterLayer => !!item && item.type === 'raster' && !item.locked && item.visible && !isProtectedImage(item);
  const above = selected ? doc.layers[doc.layers.indexOf(selected) + 1] : undefined;
  return erase ? selected?.type === 'raster' && !selected.locked && selected.visible ? selected : null : paintable(selected) ? selected : paintable(above) && !above.sourceAssetId ? above : null;
}

export function prepareStagePaint(doc: DesignDoc, erase: boolean): boolean {
  const candidate = paintCandidate(doc, erase);
  if (candidate && (!getRasterSurface(candidate.id) || (!candidate.paintFlattened && candidate.paintBaseId && !getRasterSurface(candidate.paintBaseId)))) {
    toast('Layer pixels are still loading. Try again in a moment.', 'error');
    return false;
  }
  if (candidate && requiresRasterPaintApproval(candidate) && !consumeRasterPaintApproval(candidate.id)) {
    requestRasterPaintApproval(candidate.id);
    return false;
  }
  return true;
}

export interface StagePaintGesture {
  kind: 'paint';
  live: LiveStroke;
  stroke: RasterStroke;
  layerId: string;
  last: { x: number; y: number };
  control: { x: number; y: number };
  time: number;
  erase: boolean;
  /** Drawing mode: the stroke lands in the pixels only, with no entry in the layer's editable strokes (ADR 0016). */
  direct?: boolean;
}

export function commitStagePaintGesture(args: {
  sessionId: string;
  docId: string;
  gesture: StagePaintGesture;
  brush: BrushOptions;
  limits?: RasterPaintLimits;
  clipped: boolean;
  flushFrame: () => void;
}): void {
  const { sessionId, docId, gesture, brush } = args;
  const doc = getDoc(sessionId, docId);
  const layer = doc?.layers.find((item): item is RasterLayer => item.id === gesture.layerId && item.type === 'raster');
  const pixels = getRasterSurface(gesture.layerId)?.canvas;
  if (!doc || !layer) return;

  if (pixels) endBrushStroke(gesture.stroke, gesture.live, pixels, layer, brush);
  args.flushFrame();
  commitEdit(gesture.layerId);
  if (gesture.direct) {
    setDoc(sessionId, docId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      layers: current.layers.map((item) => (item.id === gesture.layerId && item.type === 'raster' ? { ...item, rev: item.rev + 1 } : item)),
    }));
    return;
  }

  const nextStrokes = [...(layer.paintStrokes ?? []), gesture.stroke];
  const shouldFlatten = !args.clipped && (layer.paintFlattened || shouldFlattenRasterPaint({ ...layer, paintStrokes: nextStrokes }, args.limits));
  const flattenNow = shouldFlatten && !layer.paintFlattened;
  // Painting inside a selection also drops the editable strokes (the clipped branch below): same notice.
  const lostStrokes = args.clipped && !!layer.paintStrokes?.length;
  if (!gesture.erase && !args.clipped && !shouldFlatten && !layer.paintFlattened) {
    setObjectPick(docId, { layerId: gesture.layerId, ids: [gesture.stroke.id] });
  }
  setDoc(sessionId, docId, (current) => ({
    ...current,
    updatedAt: Date.now(),
    layers: current.layers.map((item) => {
      if (item.id !== gesture.layerId || item.type !== 'raster') return item;
      const rev = item.rev + 1;
      if (args.clipped) return { ...item, rev, paintBaseId: undefined, paintStrokes: undefined };
      if (item.paintFlattened) return { ...item, rev, paintBaseId: undefined, paintStrokes: undefined };
      if (flattenNow) return { ...item, rev, paintFlattened: true, paintBaseId: undefined, paintStrokes: undefined };
      return { ...item, rev, paintStrokes: nextStrokes };
    }),
  }));
  if (flattenNow || lostStrokes) toast('Strokes flattened to pixels. Undo restores editable strokes.', 'info');
}

/**
 * Drawing on a layer with editable strokes (ADR 0016): the stroke is refused before anything is recorded. Asks, or applies
 * the saved choice. True when the stroke was handled here (refused), so the caller stops.
 */
export function drawingChoiceFirst(sessionId: string, docId: string, doc: DesignDoc, erase: boolean, at?: { x: number; y: number }): boolean {
  const candidate = paintCandidate(doc, erase);
  if (!candidate || paintModeOf(doc) !== 'drawing' || !hasEditableStrokes(candidate)) return false;
  if (justClosedChoice()) return true;
  const pref = drawingPreference();
  if (pref === 'ask') requestDrawingChoice(candidate.id, at);
  else { const message = applyDrawingChoice(sessionId, docId, candidate.id, pref); if (message) toast(message, 'info'); }
  return true;
}
