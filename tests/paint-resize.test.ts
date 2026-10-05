import { afterEach, describe, expect, it, vi } from 'vitest';
import { pixelCanvas, alphaAt } from './helpers/pixelCanvas';

vi.hoisted(() => Object.assign(globalThis, { window: globalThis, document: { addEventListener() {} }, addEventListener() {} }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));
vi.mock('../src/lib/media', async () => {
  const { pixelCanvas } = await import('./helpers/pixelCanvas');
  return { createCanvas: pixelCanvas, ctx2d: (c: HTMLCanvasElement) => c.getContext('2d'), canvasToBlob: async () => new Blob() };
});
import { ANCHORS, anchorOffset, resizeCanvas } from '../src/engine/design/canvasSize';
import { addDoc, getDoc, undoDoc, redoDoc } from '../src/engine/design/actions';
import { createDoc, newRasterLayer } from '../src/engine/design/doc';
import { useStore } from '../src/store/store';
import { beginEdit, beginLiveStroke, composeRaster, flushRaster, getBuffer, paintLive, setBuffer, withPaintBase } from '../src/engine/design/raster';
import type { RasterLayer } from '../src/engine/types';
import { setDoc } from '../src/store/store';

function setup() {
  const sid = useStore.getState().activeSessionId;
  let layer = newRasterLayer('Paint', { x: 0, y: 0, width: 12, height: 12 }, { width: 12, height: 12 });
  const canvas = pixelCanvas(12, 12); canvas.getContext().fillRect(1, 1, 2, 2);
  setBuffer(layer.id, canvas as unknown as HTMLCanvasElement);
  layer = { ...withPaintBase(layer), paintStrokes: [{ id: 'first', x: 0, y: 0, erase: false, color: '#fff', opacity: 1, segments: [[8, 8, 9, 8, 2]] }] };
  composeRaster(layer);
  const doc = { ...createDoc('resize', 12, 12), layers: [layer], activeLayerId: layer.id };
  addDoc(sid, doc);
  return { sid, doc, layer };
}
const layerAt = (sid: string, id: string) => getDoc(sid, id)!.layers[0] as RasterLayer;
const pageAlpha = (layer: RasterLayer, x: number, y: number) => alphaAt(getBuffer(layer.id)!, x - layer.x, y - layer.y);
afterEach(() => flushRaster());

describe('painted layer canvas resize', () => {
  it.each(ANCHORS)('first stroke → enlarge at %s → paint in new area; undo/redo restores both buffers', anchor => {
    const { sid, doc, layer } = setup();
    const old = getBuffer(layer.id), oldBase = getBuffer(layer.paintBaseId!);
    const { dx, dy } = anchorOffset(doc, { width: 24, height: 24 }, anchor);
    expect(resizeCanvas(sid, doc.id, 24, 24, anchor)).toBeNull();
    let next = layerAt(sid, doc.id);
    expect(pageAlpha(next, dx + 1, dy + 1)).toBe(255);
    expect(pageAlpha(next, dx + 8, dy + 8)).toBe(255);
    expect(getBuffer(next.paintBaseId!)!.width).toBe(next.pxWidth);
    const x = dx === 0 ? 20 : 2, y = dy === 0 ? 20 : 2;
    const a = { x: x - next.x, y: y - next.y };
    const before = getBuffer(next.id)!;
    paintLive(beginEdit(next), beginLiveStroke(before, '#fff', 1, false), a, a, 2);
    expect(pageAlpha(next, x, y)).toBe(255);
    const added = { id: 'new', x: 0, y: 0, erase: false, color: '#fff', opacity: 1, segments: [[a.x, a.y, a.x, a.y, 2]] as [number, number, number, number, number][] };
    next = { ...next, paintStrokes: [...next.paintStrokes!, added] };
    setDoc(sid, doc.id, d => ({ ...d, layers: [next] }));
    composeRaster(next);
    expect(pageAlpha(next, x, y)).toBe(255);
    undoDoc(sid, doc.id);
    expect(getDoc(sid, doc.id)!.width).toBe(12);
    expect(layerAt(sid, doc.id)).toEqual(layer);
    expect(getBuffer(layer.id)).toBe(old);
    expect(getBuffer(layer.paintBaseId!)).toBe(oldBase);
    redoDoc(sid, doc.id);
    expect(pageAlpha(layerAt(sid, doc.id), x, y)).toBe(255);
  });
  it.each(ANCHORS)('shrink and enlarge at %s keeps the off-page pixels and editable strokes', anchor => {
    const { sid, doc } = setup();
    resizeCanvas(sid, doc.id, 4, 4, anchor);
    resizeCanvas(sid, doc.id, 12, 12, anchor);
    const next = layerAt(sid, doc.id);
    expect(pageAlpha(next, 1, 1)).toBe(255);
    expect(pageAlpha(next, 8, 8)).toBe(255);
    composeRaster(next);
    expect(pageAlpha(next, 8, 8)).toBe(255);
  });
});

import { solidPageFills, uniformOpaqueColor } from '../src/engine/design/solidPageFill';
describe('full-page solid fill stays visible after resizing', () => {
  it.each(ANCHORS)('extends the solid background with %s and restores the old buffer with undo', anchor => {
    const sid = useStore.getState().activeSessionId;
    const fill = newRasterLayer('Fill', { x: 0, y: 0, width: 12, height: 12 }, { width: 12, height: 12 });
    const pixels = pixelCanvas(12, 12); pixels.getContext().fillRect(0, 0, 12, 12);
    setBuffer(fill.id, pixels as unknown as HTMLCanvasElement);
    const doc = { ...createDoc('white page', 12, 12), layers: [fill], activeLayerId: fill.id };
    addDoc(sid, doc);
    resizeCanvas(sid, doc.id, 24, 24, anchor);
    const grown = layerAt(sid, doc.id);
    expect(pageAlpha(grown, 1, 1)).toBe(255);
    expect(pageAlpha(grown, 22, 22)).toBe(255);
    undoDoc(sid, doc.id);
    expect(getBuffer(fill.id)).toBe(pixels);
    redoDoc(sid, doc.id);
    expect(pageAlpha(layerAt(sid, doc.id), 22, 22)).toBe(255);
  });
  it('recognizes only uniform opaque pixels, including white, and rejects holes and differing colors', () => {
    expect(uniformOpaqueColor(new Uint8ClampedArray([255,255,255,255,255,255,255,255]))).toBe('#ffffff');
    expect(uniformOpaqueColor(new Uint8ClampedArray([20,40,60,255,20,40,60,255]))).toBe('#14283c');
    expect(uniformOpaqueColor(new Uint8ClampedArray([255,255,255,255,255,255,255,0]))).toBeNull();
    expect(uniformOpaqueColor(new Uint8ClampedArray([255,255,255,255,0,0,0,255]))).toBeNull();
  });
});

 it('uses full-fill provenance only at the matching pixel revision', () => {
  const layer = { ...newRasterLayer('Fill', { x: 0, y: 0, width: 12, height: 12 }, { width: 12, height: 12 }), pageFill: { color: '#ffffff', rev: 0 } };
  const pixels = pixelCanvas(12, 12);
  setBuffer(layer.id, pixels as unknown as HTMLCanvasElement);
  const doc = { ...createDoc('fill', 12, 12), layers: [layer] };
  expect(solidPageFills(doc).get(layer.id)).toBe('#ffffff');
  expect(solidPageFills({ ...doc, layers: [{ ...layer, rev: 1 }] }).size).toBe(0);
 });
