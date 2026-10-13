import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: globalThis, document: { addEventListener() {} }, addEventListener() {} }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));
vi.mock('../src/lib/media', async () => {
  const { pixelCanvas } = await import('./helpers/pixelCanvas');
  const createCanvas = (width: number, height: number) => {
    const canvas = pixelCanvas(width, height);
    const ctx = canvas.getContext() as unknown as Record<string, (...args: number[]) => unknown>;
    ctx.createImageData = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    ctx.putImageData = (image, x, y) => {
      const img = image as unknown as { width: number; height: number; data: Uint8ClampedArray };
      for (let row = 0; row < img.height; row++) for (let col = 0; col < img.width; col++) {
        canvas.pixels[(y + row) * width + x + col] = img.data[(row * img.width + col) * 4 + 3] / 255;
      }
    };
    ctx.rect = () => undefined;
    ctx.clip = () => undefined;
    return canvas;
  };
  return { createCanvas, ctx2d: (canvas: HTMLCanvasElement) => canvas.getContext('2d'), canvasToBlob: async () => new Blob() };
});
import { createDoc, newRasterLayer } from '../src/engine/design/doc';
import { moveRasterStroke } from '../src/engine/design/rasterStrokes';
import { redo, record, undo, dropHistory } from '../src/engine/design/history';
import { beginEdit, beginLiveStroke, commitEdit, composeRaster, flushRaster, getBuffer, paintLive, setBuffer, snapshotHistoryBuffers, withPaintBase } from '../src/engine/design/raster';
import { restoreRasterTiles, snapshotRasterTiles, takeRasterHistoryCopiedPixels, updateRasterTiles } from '../src/engine/design/rasterHistoryTiles';
import { alphaAt, pixelCanvas } from './helpers/pixelCanvas';
import { place } from '../src/engine/design/rasterSurface';
/** A canvas injected as a full buffer (placed over its whole size): stored as it is, as before boxes existed. */
const fullPlaced = <T extends { width: number; height: number }>(c: T): HTMLCanvasElement => place(c as unknown as HTMLCanvasElement, { x0: 0, y0: 0, fw: c.width, fh: c.height });


function pixels(canvas: HTMLCanvasElement): number[] {
  return Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data);
}

afterEach(async () => { await flushRaster(); });

describe('raster history tile snapshots', () => {
  it('shares untouched 64px tiles, copies touched tiles, and preserves exact edge dimensions and pixels', () => {
    const source = fullPlaced(pixelCanvas(130, 70) as unknown as HTMLCanvasElement);
    const ctx = source.getContext('2d')!;
    ctx.fillRect(1, 1, 4, 4);
    ctx.fillRect(64, 1, 2, 4);
    const first = snapshotRasterTiles(source);
    expect([...first.tiles.values()].map((tile) => [tile.width, tile.height])).toEqual([[64, 64], [64, 64], [2, 64], [64, 6], [64, 6], [2, 6]]);

    const edited = fullPlaced(pixelCanvas(130, 70) as unknown as HTMLCanvasElement);
    edited.getContext('2d')!.drawImage(source, 0, 0);
    edited.getContext('2d')!.fillRect(64, 1, 4, 4);
    const second = updateRasterTiles(first, edited, ['1:0']);
    expect(second.tiles.get('0:0')).toBe(first.tiles.get('0:0'));
    expect(second.tiles.get('1:0')).not.toBe(first.tiles.get('1:0'));
    expect(alphaAt(restoreRasterTiles(first), 66, 2)).toBe(0);
    expect(pixels(restoreRasterTiles(second))).toEqual(pixels(edited));
  });

  it('undoes and redoes real painted pixels while retaining only the changed history tile', () => {
    const layer = newRasterLayer('Paint', { x: 0, y: 0, width: 160, height: 80 }, { width: 160, height: 80 });
    const before = pixelCanvas(160, 80) as unknown as HTMLCanvasElement;
    before.getContext('2d')!.fillRect(8, 12, 3, 3);
    setBuffer(layer.id, before);
    const doc = { ...createDoc('tile history', 160, 80), layers: [layer], activeLayerId: layer.id };
    record(doc);
    const first = snapshotHistoryBuffers([layer.id]).get(layer.id)!;

    const working = beginEdit(layer);
    const live = beginLiveStroke(before, '#fff', 1, false);
    paintLive(working, live, { x: 10, y: 12 }, { x: 11, y: 12 }, 3);
    commitEdit(layer.id);
    const painted = getBuffer(layer.id)!;
    expect(pixels(painted)).not.toEqual(pixels(before));
    const second = snapshotHistoryBuffers([layer.id]).get(layer.id)!;
    const changed = [...first.tiles.keys()].filter((key) => first.tiles.get(key) !== second.tiles.get(key));
    expect(changed).toEqual(['0:0']);
    expect(alphaAt(first.tiles.get('0:0')!.canvas, 11, 12)).toBe(0);

    expect(undo(doc)).toBe(doc);
    const restored = getBuffer(layer.id)!;
    expect(restored).not.toBe(before);
    expect(pixels(restored)).toEqual(pixels(before));
    expect(redo(doc)).toBe(doc);
    expect(pixels(getBuffer(layer.id)!)).toEqual(pixels(painted));
    dropHistory(doc.id);
  });

  it('restores exact pixels for clipped erase and Keep Opacity strokes', () => {
    const layer = newRasterLayer('Paint', { x: 0, y: 0, width: 32, height: 24 }, { width: 32, height: 24 });
    const before = pixelCanvas(32, 24) as unknown as HTMLCanvasElement;
    before.getContext('2d')!.fillRect(8, 10, 8, 6);
    setBuffer(layer.id, before);
    const doc = { ...createDoc('brush tile history', 32, 24), layers: [layer], activeLayerId: layer.id };
    record(doc);

    const clipped = pixelCanvas(32, 24) as unknown as HTMLCanvasElement;
    clipped.getContext('2d')!.fillRect(9, 10, 3, 6);
    const edit = beginEdit(layer), erase = beginLiveStroke(before, '#fff', 1, true, clipped);
    paintLive(edit, erase, { x: 8, y: 13 }, { x: 16, y: 13 }, 4);
    commitEdit(layer.id);
    const erasedPixels = pixels(getBuffer(layer.id)!);
    expect(alphaAt(getBuffer(layer.id)!, 10, 13)).toBeLessThan(alphaAt(before, 10, 13));
    expect(alphaAt(getBuffer(layer.id)!, 14, 13)).toBe(alphaAt(before, 14, 13));
    expect(undo(doc)).toBe(doc);
    expect(pixels(getBuffer(layer.id)!)).toEqual(pixels(before));
    expect(redo(doc)).toBe(doc);
    expect(pixels(getBuffer(layer.id)!)).toEqual(erasedPixels);
    dropHistory(doc.id);

    const keepLayer = newRasterLayer('Keep', { x: 0, y: 0, width: 32, height: 24 }, { width: 32, height: 24 });
    const keepBefore = pixelCanvas(32, 24) as unknown as HTMLCanvasElement;
    keepBefore.getContext('2d')!.fillRect(8, 10, 4, 6);
    setBuffer(keepLayer.id, keepBefore);
    const keepDoc = { ...createDoc('keep opacity history', 32, 24), layers: [keepLayer], activeLayerId: keepLayer.id };
    record(keepDoc);
    const keepEdit = beginEdit(keepLayer), live = beginLiveStroke(keepBefore, '#ffffff', 1, false, null, { hardness: 1, keepOpacity: true });
    paintLive(keepEdit, live, { x: 8, y: 13 }, { x: 16, y: 13 }, 4);
    commitEdit(keepLayer.id);
    const keptPixels = pixels(getBuffer(keepLayer.id)!);
    expect(alphaAt(getBuffer(keepLayer.id)!, 10, 13)).toBe(255);
    expect(alphaAt(getBuffer(keepLayer.id)!, 14, 13)).toBe(0);
    expect(undo(keepDoc)).toBe(keepDoc);
    expect(pixels(getBuffer(keepLayer.id)!)).toEqual(pixels(keepBefore));
    expect(redo(keepDoc)).toBe(keepDoc);
    expect(pixels(getBuffer(keepLayer.id)!)).toEqual(keptPixels);
    dropHistory(keepDoc.id);
  });

  it('restores exact large-canvas stroke pixels across 64px tile boundaries on undo and redo', () => {
    const firstStroke = { id: 'crossing', x: 0, y: 0, color: '#ffffff', opacity: 0.5, erase: false, segments: [[50, 30, 70, 30, 6] as [number, number, number, number, number]] };
    const secondStroke = { ...firstStroke, id: 'neighbor', segments: [[80, 48, 100, 48, 8] as [number, number, number, number, number]] };
    const plain = { ...newRasterLayer('Paint', { x: 0, y: 0, width: 200, height: 100 }, { width: 200, height: 100 }), paintStrokes: [firstStroke, secondStroke] };
    const base = pixelCanvas(200, 100) as unknown as HTMLCanvasElement;
    base.getContext('2d')!.fillRect(2, 2, 30, 20);
    setBuffer(plain.id, base);
    const layer = { ...withPaintBase(plain), paintStrokes: plain.paintStrokes };
    composeRaster(layer);
    const doc = { ...createDoc('cross tile strokes', 200, 100), layers: [layer], activeLayerId: layer.id };
    record(doc);
    const originalPixels = pixels(getBuffer(layer.id)!);

    const moved = moveRasterStroke(layer, firstStroke.id, 8, 2);
    composeRaster(moved);
    const movedPixels = pixels(getBuffer(layer.id)!);
    expect(movedPixels).not.toEqual(originalPixels);
    expect(undo({ ...doc, layers: [moved] })!.layers[0]).toEqual(layer);
    expect(pixels(getBuffer(layer.id)!)).toEqual(originalPixels);
    expect(redo(doc)!.layers[0]).toEqual(moved);
    expect(pixels(getBuffer(layer.id)!)).toEqual(movedPixels);
    dropHistory(doc.id);
  });

  it('preserves local setBuffer tile sharing and clamps huge or off-canvas dirty regions', () => {
    const layer = newRasterLayer('Move', { x: 0, y: 0, width: 130, height: 70 }, { width: 130, height: 70 });
    const base = fullPlaced(pixelCanvas(130, 70) as unknown as HTMLCanvasElement);
    setBuffer(layer.id, base, false);
    const first = snapshotHistoryBuffers([layer.id]).get(layer.id)!;
    expect(takeRasterHistoryCopiedPixels()).toBe(130 * 70);

    setBuffer(layer.id, base, false, { x0: -1000, y0: -1000, x1: -900, y1: -900 });
    const outside = snapshotHistoryBuffers([layer.id]).get(layer.id)!;
    expect([...first.tiles.keys()].every((key) => first.tiles.get(key) === outside.tiles.get(key))).toBe(true);
    expect(takeRasterHistoryCopiedPixels()).toBe(0);

    const moved = fullPlaced(pixelCanvas(130, 70) as unknown as HTMLCanvasElement);
    moved.getContext('2d')!.drawImage(base, 0, 0);
    moved.getContext('2d')!.fillRect(65, 2, 3, 3);
    setBuffer(layer.id, moved, false, { x0: 65, y0: 2, x1: 68, y1: 5 });
    const local = snapshotHistoryBuffers([layer.id]).get(layer.id)!;
    expect([...first.tiles.keys()].filter((key) => first.tiles.get(key) !== local.tiles.get(key))).toEqual(['1:0']);
    expect(pixels(restoreRasterTiles(local))).toEqual(pixels(moved));
    expect(takeRasterHistoryCopiedPixels()).toBe(64 * 64);

    const broadlyDirty = fullPlaced(pixelCanvas(130, 70) as unknown as HTMLCanvasElement);
    broadlyDirty.getContext('2d')!.drawImage(moved, 0, 0);
    broadlyDirty.getContext('2d')!.fillRect(4, 60, 2, 2);
    setBuffer(layer.id, broadlyDirty, false, { x0: -1_000_000, y0: -1_000_000, x1: 1_000_000, y1: 1_000_000 });
    const second = snapshotHistoryBuffers([layer.id]).get(layer.id)!;
    expect([...local.tiles.keys()].filter((key) => local.tiles.get(key) !== second.tiles.get(key))).toHaveLength(local.tiles.size);
    expect(takeRasterHistoryCopiedPixels()).toBe(130 * 70);
    expect(pixels(restoreRasterTiles(second))).toEqual(pixels(broadlyDirty));
  });
});
