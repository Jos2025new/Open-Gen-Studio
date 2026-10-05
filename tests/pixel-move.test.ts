import { afterEach, describe, expect, it, vi } from 'vitest';
import { pixelCanvas, alphaAt } from './helpers/pixelCanvas';
vi.hoisted(() => Object.assign(globalThis, { window: globalThis, document: { addEventListener() {} }, addEventListener() {} }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));
vi.mock('../src/lib/media', async () => {
  const { pixelCanvas } = await import('./helpers/pixelCanvas');
  return { createCanvas: pixelCanvas, ctx2d: (c: HTMLCanvasElement) => c.getContext('2d'), canvasToBlob: async () => new Blob() };
});
import { addDoc, getDoc, undoDoc, redoDoc } from '../src/engine/design/actions';
import { createDoc, newRasterLayer } from '../src/engine/design/doc';
import { useStore } from '../src/store/store';
import { getBuffer, setBuffer, flushRaster } from '../src/engine/design/raster';
import { historyDepth } from '../src/engine/design/history';
import { getSelection, rectPoints, selectionToLayer, setSelection } from '../src/engine/design/pixelSelection';
import { startPixelMove } from '../src/engine/design/pixelMove';

function setup(locked = false) {
  const sid = useStore.getState().activeSessionId;
  const layer = { ...newRasterLayer('Original', { x: 0, y: 0, width: 12, height: 12 }, { width: 12, height: 12 }), locked };
  const canvas = pixelCanvas(12, 12); canvas.getContext().fillRect(0, 0, 12, 12);
  setBuffer(layer.id, canvas as unknown as HTMLCanvasElement);
  const doc = { ...createDoc('selection', 12, 12), layers: [layer], activeLayerId: layer.id };
  addDoc(sid, doc); return { sid, doc, layer, canvas };
}
const point = { x: 3, y: 3 };
afterEach(() => flushRaster());

describe('dragging selected pixels', () => {
  it.each(['rectangle', 'irregular', 'soft mask'])('%s: cuts pixels, moves only the new layer, one undo and redo', shape => {
    const { sid, doc, layer, canvas } = setup();
    if (shape === 'soft mask') {
      const mask = pixelCanvas(12, 12); mask.getContext().fillRect(2, 2, 4, 4); mask.pixels[3 * 12 + 3] = .5;
      setSelection(doc.id, { points: [], mask: mask as unknown as HTMLCanvasElement, box: { x: 2, y: 2, w: 4, h: 4 } });
    } else setSelection(doc.id, { points: shape === 'rectangle' ? rectPoints(2, 2, 6, 6) : [[2, 2], [8, 2], [2, 8]] });
    const move = startPixelMove(sid, doc, point, 1);
    expect(move).not.toBeNull(); expect(move).not.toBe(true);
    if (!move || move === true) throw new Error('No pixel move');
    move.update(point);
    expect(getDoc(sid, doc.id)!.layers).toHaveLength(1); // A click never extracts.
    move.update({ x: 8, y: 7 });
    move.update({ x: 9, y: 8 });
    const after = getDoc(sid, doc.id)!;
    expect(after.layers).toHaveLength(2);
    expect(after.layers[0]).toMatchObject({ id: layer.id, x: 0, y: 0 });
    expect(after.layers[1]).toMatchObject({ x: 6, y: 5 });
    const expected = shape === 'soft mask' ? 128 : 0;
    expect(alphaAt(getBuffer(layer.id)!, 3, 3)).toBe(expected);
    expect(alphaAt(getBuffer(after.layers[1].id)!, 3, 3)).toBe(shape === 'soft mask' ? 128 : 255);
    expect(alphaAt(getBuffer(layer.id)!, 10, 10)).toBe(255);
    if (shape === 'irregular') expect(alphaAt(getBuffer(after.layers[1].id)!, 7, 7)).toBe(0);
    expect(historyDepth(doc.id).undo).toBe(1);
    expect(getSelection(doc.id)).toBeNull();
    undoDoc(sid, doc.id);
    expect(getDoc(sid, doc.id)).toEqual(doc);
    expect(getBuffer(layer.id)).toBe(canvas);
    expect(getSelection(doc.id)).not.toBeNull();
    redoDoc(sid, doc.id);
    expect(getDoc(sid, doc.id)).toEqual(after);
    expect(alphaAt(getBuffer(layer.id)!, 3, 3)).toBe(expected);
  });
  it('a locked layer refuses extraction, reports a toast, and records no undo', () => {
    const { sid, doc, layer } = setup(true);
    setSelection(doc.id, { points: rectPoints(2, 2, 6, 6) });
    expect(startPixelMove(sid, doc, point, 1)).toBe(true);
    expect(getDoc(sid, doc.id)).toEqual(doc);
    expect(alphaAt(getBuffer(layer.id)!, 3, 3)).toBe(255);
    expect(historyDepth(doc.id).undo).toBe(0);
    expect(useStore.getState().ui.toasts.at(-1)!.text).toContain('locked');
  });
  it('outside or without selection keeps ordinary moving; Ctrl+J still copies without cutting', () => {
    const { sid, doc, layer } = setup();
    expect(startPixelMove(sid, doc, point, 1)).toBeNull();
    setSelection(doc.id, { points: rectPoints(2, 2, 6, 6) });
    expect(startPixelMove(sid, doc, { x: 10, y: 10 }, 1)).toBeNull();
    expect(selectionToLayer(sid, doc)).toBeNull();
    expect(getDoc(sid, doc.id)!.layers).toHaveLength(2);
    expect(alphaAt(getBuffer(layer.id)!, 3, 3)).toBe(255);
  });
});
