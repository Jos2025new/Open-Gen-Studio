import { addDoc, deleteDoc, getDoc, redoDoc, undoDoc } from '../../src/engine/design/actions';
import { createDoc, newRasterLayer } from '../../src/engine/design/doc';
import { dropHistory, historyDepth, record } from '../../src/engine/design/history';
import { deleteBuffers, flushRaster, getBuffer, setBuffer } from '../../src/engine/design/raster';
import { commitStagePaintGesture } from '../../src/components/designer/StagePaintCommit';
import type { BrushOptions } from '../../src/engine/design/brushEngine';
import type { LiveStroke } from '../../src/engine/design/raster';
import type { RasterLayer, RasterStroke } from '../../src/engine/types';
import { ctx2d, createCanvas } from '../../src/lib/media';
import { useStore } from '../../src/store/store';

function readPixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  return ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
}

function comparePixels(expected: Uint8ClampedArray, actual: Uint8ClampedArray): { exact: boolean; differentPixels: number; differentChannels: number; maxChannelDelta: number } {
  let differentPixels = 0, differentChannels = 0, maxChannelDelta = 0;
  for (let i = 0; i < expected.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(expected[i + c] - actual[i + c]);
      if (delta) { changed = true; differentChannels++; maxChannelDelta = Math.max(maxChannelDelta, delta); }
    }
    if (changed) differentPixels++;
  }
  return { exact: differentChannels === 0, differentPixels, differentChannels, maxChannelDelta };
}

function copyPaint(source: HTMLCanvasElement, color: string, x: number, y: number): HTMLCanvasElement {
  const out = createCanvas(source.width, source.height), ctx = ctx2d(out);
  ctx.drawImage(source, 0, 0);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 11, 9);
  ctx.fillStyle = 'rgba(24, 170, 235, .43)';
  ctx.beginPath();
  ctx.arc(x + 8.25, y + 5.5, 6.2, 0, Math.PI * 2);
  ctx.fill();
  return out;
}

function probeStroke(id: string): RasterStroke {
  return { id, x: 0, y: 0, color: '#be2984', opacity: 0.71, erase: false, segments: [[10, 10, 24, 19, 5]] };
}

function commitPixelGesture(sessionId: string, docId: string, layerId: string, stagePixels: HTMLCanvasElement, stroke: RasterStroke, limits?: { strokes: number; segments: number }): void {
  const doc = getDoc(sessionId, docId);
  if (!doc) throw new Error('Raster limit probe document disappeared');
  record(doc);
  setBuffer(layerId, stagePixels, false);
  commitStagePaintGesture({
    sessionId, docId,
    gesture: { kind: 'paint', live: {} as LiveStroke, stroke, layerId, last: { x: 12, y: 12 }, control: { x: 12, y: 12 }, time: 0, erase: false },
    brush: { taperEnd: 0 } as BrushOptions,
    clipped: false,
    flushFrame: () => undefined,
    limits,
  });
}

/** Browser RGB+A check for quota flattening, one-step undo/redo, and continued pixel-mode painting. */
export async function runRasterLimitParity(): Promise<Record<string, unknown>> {
  const width = 64, height = 48;
  const sessionId = useStore.getState().activeSessionId;
  if (!sessionId) throw new Error('Raster limit probe requires an active sandbox session');
  const layer = { ...newRasterLayer('Raster quota parity probe', { x: 0, y: 0, width, height }, { width, height }), paintStrokes: [probeStroke('existing-editable')] };
  const doc = { ...createDoc('Raster quota parity probe', width, height), layers: [layer], activeLayerId: layer.id };
  const before = createCanvas(width, height), beforeCtx = ctx2d(before);
  beforeCtx.fillStyle = 'rgba(225, 39, 61, .42)'; beforeCtx.fillRect(2, 3, 31, 27);
  beforeCtx.fillStyle = '#2874be'; beforeCtx.fillRect(34, 8, 18, 24);
  const beforePixels = readPixels(before);
  let flattenedPixels: Uint8ClampedArray | undefined, directPixels: Uint8ClampedArray | undefined;
  const limits = { strokes: 2, segments: 100 };
  try {
    setBuffer(layer.id, before, false);
    addDoc(sessionId, doc);

    const flattenedCanvas = copyPaint(before, 'rgba(250, 210, 25, .66)', 15, 13);
    flattenedPixels = readPixels(flattenedCanvas);
    commitPixelGesture(sessionId, doc.id, layer.id, flattenedCanvas, probeStroke('quota-trigger'), limits);
    const afterFlatten = getDoc(sessionId, doc.id)?.layers[0] as RasterLayer | undefined;
    const flattenState = { paintFlattened: afterFlatten?.paintFlattened, paintStrokes: afterFlatten?.paintStrokes, paintBaseId: afterFlatten?.paintBaseId };
    const flattenDiff = comparePixels(flattenedPixels, readPixels(getBuffer(layer.id)!));
    const flattenUndoDepth = historyDepth(doc.id).undo;

    undoDoc(sessionId, doc.id);
    const restoredEditable = getDoc(sessionId, doc.id)?.layers[0] as RasterLayer | undefined;
    const undoDiff = comparePixels(beforePixels, readPixels(getBuffer(layer.id)!));
    const undoState = { paintFlattened: restoredEditable?.paintFlattened, strokeCount: restoredEditable?.paintStrokes?.length ?? 0, undoDepth: historyDepth(doc.id).undo };

    redoDoc(sessionId, doc.id);
    const redoneFlattened = getDoc(sessionId, doc.id)?.layers[0] as RasterLayer | undefined;
    const redoDiff = comparePixels(flattenedPixels, readPixels(getBuffer(layer.id)!));
    const redoState = { paintFlattened: redoneFlattened?.paintFlattened, strokeCount: redoneFlattened?.paintStrokes?.length ?? 0, undoDepth: historyDepth(doc.id).undo };

    const nextCanvas = copyPaint(getBuffer(layer.id)!, 'rgba(19, 212, 119, .58)', 39, 17);
    directPixels = readPixels(nextCanvas);
    commitPixelGesture(sessionId, doc.id, layer.id, nextCanvas, probeStroke('direct-pixel-follow-up'), limits);
    const afterDirect = getDoc(sessionId, doc.id)?.layers[0] as RasterLayer | undefined;
    const directDiff = comparePixels(directPixels, readPixels(getBuffer(layer.id)!));
    const directState = { paintFlattened: afterDirect?.paintFlattened, strokeCount: afterDirect?.paintStrokes?.length ?? 0, undoDepth: historyDepth(doc.id).undo };
    undoDoc(sessionId, doc.id);
    const directUndoLayer = getDoc(sessionId, doc.id)?.layers[0] as RasterLayer | undefined;
    const directUndoDiff = comparePixels(flattenedPixels, readPixels(getBuffer(layer.id)!));
    const directUndoState = { paintFlattened: directUndoLayer?.paintFlattened, strokeCount: directUndoLayer?.paintStrokes?.length ?? 0, undoDepth: historyDepth(doc.id).undo };
    redoDoc(sessionId, doc.id);
    const directRedoDiff = comparePixels(directPixels, readPixels(getBuffer(layer.id)!));
    const directRedoLayer = getDoc(sessionId, doc.id)?.layers[0] as RasterLayer | undefined;
    const directRedoState = { paintFlattened: directRedoLayer?.paintFlattened, strokeCount: directRedoLayer?.paintStrokes?.length ?? 0, undoDepth: historyDepth(doc.id).undo };

    const parity = { flatten: flattenDiff, undo: undoDiff, redo: redoDiff, directNext: directDiff, directUndo: directUndoDiff, directRedo: directRedoDiff };
    const flags = { flatten: flattenState, undo: undoState, redo: redoState, directNext: directState, directUndo: directUndoState, directRedo: directRedoState };
    const accepted = flattenDiff.exact && undoDiff.exact && redoDiff.exact && directDiff.exact && directUndoDiff.exact && directRedoDiff.exact
      && flattenState.paintFlattened === true && flattenState.paintStrokes === undefined
      && undoState.strokeCount === 1 && undoState.paintFlattened === undefined && undoState.undoDepth === 0
      && redoState.paintFlattened === true && redoState.strokeCount === 0 && redoState.undoDepth === 1
      && directState.paintFlattened === true && directState.strokeCount === 0 && directState.undoDepth === 2
      && directUndoState.paintFlattened === true && directUndoState.strokeCount === 0 && directUndoState.undoDepth === 1
      && directRedoState.paintFlattened === true && directRedoState.strokeCount === 0 && directRedoState.undoDepth === 2;
    if (!accepted) throw new Error(`Raster quota RGB+A parity failed: ${JSON.stringify({ parity, flags })}`);
    return { mode: 'raster-limit', dimensions: { width, height }, limits, parity, flags, accepted };
  } finally {
    await flushRaster();
    dropHistory(doc.id);
    await deleteBuffers([layer.id]);
    deleteDoc(sessionId, doc.id);
    await flushRaster();
  }
}
