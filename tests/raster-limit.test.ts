import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: globalThis, document: { addEventListener() {} }, addEventListener() {} }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));
vi.mock('../src/lib/media', async () => {
  const { pixelCanvas } = await import('./helpers/pixelCanvas');
  return { createCanvas: pixelCanvas, ctx2d: (canvas: HTMLCanvasElement) => canvas.getContext('2d'), canvasToBlob: async () => new Blob() };
});
import { createDoc, cloneLayer, newRasterLayer } from '../src/engine/design/doc';
import { addDoc, getDoc, redoDoc, undoDoc } from '../src/engine/design/actions';
import { commitStagePaintGesture, prepareStagePaint } from '../src/components/designer/StagePaintCommit';
import {
  DEFAULT_PAINT_SEGMENT_LIMIT,
  DEFAULT_PAINT_STROKE_LIMIT,
  armNextRasterPaint,
  cancelRasterPaintApproval,
  consumeRasterPaintApproval,
  pendingRasterPaintLayer,
  rasterPaintUsage,
  requestRasterPaintApproval,
  requiresRasterPaintApproval,
  shouldFlattenRasterPaint,
} from '../src/engine/design/rasterLimit';
import { dropHistory, historyDepth, record } from '../src/engine/design/history';
import { flushRaster, getBuffer, setBuffer } from '../src/engine/design/raster';
import type { RasterLayer, RasterStroke } from '../src/engine/types';
import type { BrushOptions } from '../src/engine/design/brushEngine';
import type { LiveStroke } from '../src/engine/design/raster';
import { useStore } from '../src/store/store';
import { pixelCanvas } from './helpers/pixelCanvas';

const stroke = (id: string, segments = 1): RasterStroke => ({
  id, x: 0, y: 0, color: '#ffffff', opacity: 1, erase: false,
  segments: Array.from({ length: segments }, () => [1, 1, 2, 1, 1] as [number, number, number, number, number]),
});
const layerWith = (strokes: RasterStroke[], patch: Partial<RasterLayer> = {}): RasterLayer => ({
  ...newRasterLayer('Paint', { x: 0, y: 0, width: 8, height: 8 }, { width: 8, height: 8 }),
  paintStrokes: strokes,
  ...patch,
});

afterEach(async () => {
  const pending = pendingRasterPaintLayer();
  if (pending) cancelRasterPaintApproval(pending);
  await flushRaster();
});

describe('provisional editable raster quota', () => {
  it('counts strokes and segment tuples without mutating the layer', () => {
    const layer = layerWith([stroke('a', 2), stroke('b', 3)]);
    expect(rasterPaintUsage(layer)).toEqual({ strokes: 2, segments: 5 });
    expect(shouldFlattenRasterPaint(layer, { strokes: 2, segments: 10 })).toBe(true);
    expect(shouldFlattenRasterPaint(layer, { strokes: 10, segments: 5 })).toBe(true);
    expect(layer.paintStrokes).toHaveLength(2);
  });

  it('keeps the provisional defaults at 64 strokes and 8192 segments', () => {
    expect(DEFAULT_PAINT_STROKE_LIMIT).toBe(64);
    expect(DEFAULT_PAINT_SEGMENT_LIMIT).toBe(8192);
  });

  it('does not convert an older over-limit layer until painting is explicitly approved', () => {
    const old = layerWith(Array.from({ length: 65 }, (_, i) => stroke(String(i))));
    expect(requiresRasterPaintApproval(old)).toBe(true);
    expect(old.paintFlattened).toBeUndefined();
    expect(old.paintStrokes).toHaveLength(65);
  });

  it('allows one confirmed paint only on the approved layer', () => {
    requestRasterPaintApproval('old-layer');
    armNextRasterPaint('old-layer');
    expect(pendingRasterPaintLayer()).toBeNull();
    expect(consumeRasterPaintApproval('other-layer')).toBe(false);
    expect(consumeRasterPaintApproval('old-layer')).toBe(true);
    expect(consumeRasterPaintApproval('old-layer')).toBe(false);
  });

  it('blocks an old full layer before recording history and cancel leaves its quota unchanged', () => {
    const sid = useStore.getState().activeSessionId;
    const old = layerWith(Array.from({ length: 64 }, (_, i) => stroke(String(i))));
    const doc = { ...createDoc('old full', 8, 8), layers: [old], activeLayerId: old.id };
    setBuffer(old.id, pixelCanvas(8, 8) as unknown as HTMLCanvasElement);
    addDoc(sid, doc);
    const before = getDoc(sid, doc.id)!;
    expect(prepareStagePaint(before, false)).toBe(false);
    expect(pendingRasterPaintLayer()).toBe(old.id);
    expect(historyDepth(doc.id).undo).toBe(0);
    cancelRasterPaintApproval(old.id);
    expect(historyDepth(doc.id).undo).toBe(0);
    expect(getDoc(sid, doc.id)!.layers[0]).toEqual(old);
    dropHistory(doc.id);
  });

  it('keeps the quota opt-out and flattened mode when a layer is duplicated; new layers start fresh', () => {
    const source = layerWith([stroke('a')], { paintFlattened: true, paintLimitDisabled: true });
    expect(cloneLayer(source)).toMatchObject({ paintFlattened: true, paintLimitDisabled: true });
    const fresh = newRasterLayer('New', { x: 0, y: 0, width: 8, height: 8 }, { width: 8, height: 8 });
    expect(requiresRasterPaintApproval(fresh)).toBe(false);
    expect(shouldFlattenRasterPaint(fresh)).toBe(false);
  });

  it('keeps the exact Stage-painted pixels and undo restores strokes and prior buffer in one step', () => {
    const sid = useStore.getState().activeSessionId;
    const base = pixelCanvas(8, 8);
    const prior = pixelCanvas(8, 8); prior.getContext().fillRect(1, 1, 1, 1);
    const painted = pixelCanvas(8, 8); painted.getContext().fillRect(3, 4, 2, 1);
    const editable = layerWith([stroke('a'), stroke('b')], { paintBaseId: 'paint-base', opacity: 0.6, blend: 'multiply' });
    const doc = { ...createDoc('quota', 8, 8), layers: [editable], activeLayerId: editable.id };
    setBuffer('paint-base', base as unknown as HTMLCanvasElement);
    setBuffer(editable.id, prior as unknown as HTMLCanvasElement);
    addDoc(sid, doc);
    const current = getDoc(sid, doc.id)!;
    record(current);
    // This is the Stage live buffer after its final segment; flattening must use this exact object.
    setBuffer(editable.id, painted as unknown as HTMLCanvasElement);
    const added = stroke('c');
    commitStagePaintGesture({
      sessionId: sid,
      docId: doc.id,
      gesture: { kind: 'paint', live: {} as LiveStroke, stroke: added, layerId: editable.id, last: { x: 2, y: 2 }, control: { x: 2, y: 2 }, time: 0, erase: false },
      brush: { taperEnd: 0 } as BrushOptions,
      clipped: false,
      flushFrame: () => undefined,
      limits: { strokes: 3, segments: 100 },
    });
    const flattened = getDoc(sid, doc.id)!.layers[0] as RasterLayer;
    expect(flattened).toMatchObject({ paintFlattened: true, paintBaseId: undefined, paintStrokes: undefined, opacity: 0.6, blend: 'multiply' });
    expect(getBuffer(editable.id)).toBe(painted);
    expect(Array.from(getBuffer(editable.id)!.getContext('2d')!.getImageData(0, 0, 8, 8).data)).toEqual(Array.from(painted.getContext().getImageData(0, 0, 8, 8).data));
    expect(historyDepth(doc.id).undo).toBe(1);

    undoDoc(sid, doc.id);
    expect(getDoc(sid, doc.id)!.layers[0]).toEqual(editable);
    expect(getBuffer(editable.id)).toBe(prior);
    expect(historyDepth(doc.id).undo).toBe(0);

    redoDoc(sid, doc.id);
    expect(getDoc(sid, doc.id)!.layers[0]).toEqual(flattened);
    expect(getBuffer(editable.id)).toBe(painted);
    expect(getDoc(sid, doc.id)!.layers[0]).not.toBe(current.layers[0]);
    dropHistory(doc.id);
  });

  it('keeps direct pixel mode after flattening and an opted-out layer stays editable past custom limits', () => {
    const sid = useStore.getState().activeSessionId;
    const editable = layerWith([stroke('a')], { opacity: 0.4, blend: 'multiply' });
    const doc = { ...createDoc('quota follow-up', 8, 8), layers: [editable], activeLayerId: editable.id };
    const prior = pixelCanvas(8, 8);
    addDoc(sid, doc);
    setBuffer(editable.id, prior as unknown as HTMLCanvasElement);
    const paint = (id: string, limits: { strokes: number; segments: number }) => {
      const before = getDoc(sid, doc.id)!;
      record(before);
      const nextPixels = pixelCanvas(8, 8); nextPixels.getContext().fillRect(id === 'flatten' ? 2 : 5, 3, 1, 1);
      setBuffer(editable.id, nextPixels as unknown as HTMLCanvasElement);
      commitStagePaintGesture({
        sessionId: sid, docId: doc.id,
        gesture: { kind: 'paint', live: {} as LiveStroke, stroke: { ...stroke(id), erase: id === 'erase' }, layerId: editable.id, last: { x: 2, y: 2 }, control: { x: 2, y: 2 }, time: 0, erase: id === 'erase' },
        brush: { taperEnd: 0 } as BrushOptions, clipped: false, flushFrame: () => undefined, limits,
      });
      return nextPixels;
    };
    const flattenedPixels = paint('flatten', { strokes: 2, segments: 100 });
    expect(getDoc(sid, doc.id)!.layers[0]).toMatchObject({ paintFlattened: true, paintStrokes: undefined });
    const laterPixels = paint('erase', { strokes: 2, segments: 100 });
    expect(getBuffer(editable.id)).toBe(laterPixels);
    expect(getDoc(sid, doc.id)!.layers[0]).toMatchObject({ paintFlattened: true, paintStrokes: undefined });
    expect(Array.from(getBuffer(editable.id)!.getContext('2d')!.getImageData(0, 0, 8, 8).data)).toEqual(Array.from(laterPixels.getContext().getImageData(0, 0, 8, 8).data));
    expect(flattenedPixels).not.toBe(laterPixels);
    undoDoc(sid, doc.id);
    expect(getDoc(sid, doc.id)!.layers[0]).toMatchObject({ paintFlattened: true, paintStrokes: undefined, opacity: 0.4, blend: 'multiply' });

    const optedOut = layerWith([stroke('already-full'), stroke('second')], { paintLimitDisabled: true });
    expect(shouldFlattenRasterPaint(optedOut, { strokes: 2, segments: 100 })).toBe(false);
    expect(requiresRasterPaintApproval(optedOut, { strokes: 2, segments: 100 })).toBe(false);
    const optDoc = { ...createDoc('opted-out', 8, 8), layers: [optedOut], activeLayerId: optedOut.id };
    addDoc(sid, optDoc);
    setBuffer(optedOut.id, pixelCanvas(8, 8) as unknown as HTMLCanvasElement);
    record(getDoc(sid, optDoc.id)!);
    commitStagePaintGesture({
      sessionId: sid, docId: optDoc.id,
      gesture: { kind: 'paint', live: {} as LiveStroke, stroke: stroke('over-limit'), layerId: optedOut.id, last: { x: 2, y: 2 }, control: { x: 2, y: 2 }, time: 0, erase: false },
      brush: { taperEnd: 0 } as BrushOptions, clipped: false, flushFrame: () => undefined,
      limits: { strokes: 2, segments: 100 },
    });
    expect(getDoc(sid, optDoc.id)!.layers[0]).toMatchObject({ paintLimitDisabled: true, paintStrokes: [stroke('already-full'), stroke('second'), stroke('over-limit')] });
    expect((getDoc(sid, optDoc.id)!.layers[0] as RasterLayer).paintFlattened).toBeUndefined();
    dropHistory(doc.id);
    dropHistory(optDoc.id);
  });

  it('serializes optional mode flags while leaving legacy layer objects compatible', () => {
    const old = layerWith([]);
    const parsedOld = JSON.parse(JSON.stringify(old)) as RasterLayer;
    expect(parsedOld.paintFlattened).toBeUndefined();
    expect(parsedOld.paintLimitDisabled).toBeUndefined();
    const current = JSON.parse(JSON.stringify({ ...old, paintFlattened: true, paintLimitDisabled: true })) as RasterLayer;
    expect(current).toMatchObject({ paintFlattened: true, paintLimitDisabled: true });
  });
});
