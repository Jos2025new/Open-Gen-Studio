import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: globalThis, document: { addEventListener() {} }, addEventListener() {} }));
// Saved blobs are kept in memory: a blob carries its canvas, so loading gives back the very pixels that were saved.
const stored = new Map<string, unknown>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined },
  blobDb: {
    set: async (key: string, blob: unknown) => { stored.set(key, blob); },
    get: async (key: string) => stored.get(key),
    delMany: async () => undefined,
  },
}));
vi.mock('../src/lib/media', async () => {
  const { pixelCanvas } = await import('./helpers/pixelCanvas');
  const createCanvas = (width: number, height: number) => {
    const canvas = pixelCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    const ctx = canvas.getContext() as unknown as Record<string, unknown>;
    ctx.createImageData = (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    ctx.putImageData = (image: unknown, x: number, y: number) => {
      const img = image as { width: number; height: number; data: Uint8ClampedArray };
      for (let row = 0; row < img.height; row++) for (let col = 0; col < img.width; col++) {
        canvas.pixels[(y + row) * canvas.width + x + col] = img.data[(row * img.width + col) * 4 + 3] / 255;
      }
    };
    ctx.rect = () => undefined;
    ctx.clip = () => undefined;
    return canvas;
  };
  return {
    createCanvas,
    ctx2d: (canvas: HTMLCanvasElement) => canvas.getContext('2d'),
    canvasToBlob: async (canvas: unknown) => ({ source: canvas }),
    blobToCanvas: async (blob: { source: HTMLCanvasElement }) => {
      const copy = createCanvas(blob.source.width, blob.source.height);
      (copy as unknown as { pixels: Float64Array }).pixels.set((blob.source as unknown as { pixels: Float64Array }).pixels);
      return copy;
    },
  };
});

import { newRasterLayer } from '../src/engine/design/doc';
import { beginEdit, beginLiveStroke, commitEdit, deleteBuffers, ensureBuffers, flushRaster, getBuffer, getRasterSurface, paintLive, setBuffer } from '../src/engine/design/raster';
import { alphaAt, pixelCanvas } from './helpers/pixelCanvas';

const pixelsOf = (c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data);
const blank = (w: number, h: number) => pixelCanvas(w, h) as unknown as HTMLCanvasElement;

/** Paint one short segment on a layer the way the Designer does: a live stroke on a copy of its pixels, then commit. */
function paint(id: string, a: { x: number; y: number }, b: { x: number; y: number }, layer: ReturnType<typeof newRasterLayer>) {
  const before = getRasterSurface(id)!.canvas;
  const edit = beginEdit(layer);
  const live = beginLiveStroke(before, '#ffffff', 1, false, null, { hardness: 1 });
  paintLive(edit, live, a, b, 4);
  commitEdit(id);
}

describe('raster boxes: a layer keeps only the box of its pixels', () => {
  it('paints inside and outside the box, and grows it when a stroke leaves it', () => {
    const layer = newRasterLayer('Grow', { x: 0, y: 0, width: 300, height: 200 }, { width: 300, height: 200 });
    setBuffer(layer.id, blank(300, 200));
    expect(getRasterSurface(layer.id)!.canvas.width * getRasterSurface(layer.id)!.canvas.height).toBeLessThanOrEqual(1);

    paint(layer.id, { x: 10, y: 10 }, { x: 14, y: 10 }, layer);
    const first = getRasterSurface(layer.id)!;
    expect(alphaAt(getBuffer(layer.id)!, 12, 10)).toBeGreaterThan(0);
    expect(first.canvas.width).toBeLessThan(300);

    paint(layer.id, { x: 250, y: 150 }, { x: 252, y: 150 }, layer);
    const grown = getRasterSurface(layer.id)!;
    expect(alphaAt(getBuffer(layer.id)!, 12, 10)).toBeGreaterThan(0);
    expect(alphaAt(getBuffer(layer.id)!, 251, 150)).toBeGreaterThan(0);
    expect(grown.x0).toBeLessThanOrEqual(10);
    expect(grown.x0 + grown.canvas.width).toBeGreaterThanOrEqual(252);
    expect(grown.y0 + grown.canvas.height).toBeGreaterThanOrEqual(151);
    expect(grown.x0 % 64).toBe(0);
    expect(grown.y0 % 64).toBe(0);
  });

  it('an empty layer has no pixels: a 1 × 1 box, and a full buffer of blank pixels', () => {
    const layer = newRasterLayer('Empty', { x: 0, y: 0, width: 128, height: 96 }, { width: 128, height: 96 });
    setBuffer(layer.id, blank(128, 96));
    const surface = getRasterSurface(layer.id)!;
    expect(surface.canvas.width * surface.canvas.height).toBe(1);
    expect(surface.fw).toBe(128);
    expect(surface.fh).toBe(96);
    expect(getBuffer(layer.id)!.width).toBe(128);
    expect(pixelsOf(getBuffer(layer.id)!).every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
  });

  it('saving writes the full page, and loading crops it back to the same pixels', async () => {
    const layer = newRasterLayer('Round', { x: 0, y: 0, width: 200, height: 120 }, { width: 200, height: 120 });
    setBuffer(layer.id, blank(200, 120));
    paint(layer.id, { x: 100, y: 60 }, { x: 110, y: 64 }, layer);
    const before = pixelsOf(getBuffer(layer.id)!);
    const boxArea = getRasterSurface(layer.id)!.canvas.width * getRasterSurface(layer.id)!.canvas.height;
    expect(boxArea).toBeLessThan(200 * 120);

    await flushRaster();
    const saved = stored.get(`raster:${layer.id}`) as { source: HTMLCanvasElement };
    expect(saved.source.width).toBe(200);
    expect(saved.source.height).toBe(120);
    expect(pixelsOf(saved.source)).toEqual(before);

    await deleteBuffers([layer.id]); // forget the pixels in memory: the next load reads the saved file
    await ensureBuffers([layer]);
    expect(pixelsOf(getBuffer(layer.id)!)).toEqual(before);
    expect(getRasterSurface(layer.id)!.canvas.width * getRasterSurface(layer.id)!.canvas.height).toBeLessThan(200 * 120);
  });

  it('a small stroke on a 2048 × 2048 layer takes under 5 % of a full page canvas', () => {
    const layer = newRasterLayer('Big', { x: 0, y: 0, width: 2048, height: 2048 }, { width: 2048, height: 2048 });
    setBuffer(layer.id, blank(2048, 2048));
    paint(layer.id, { x: 1000, y: 1000 }, { x: 1040, y: 1010 }, layer);
    const surface = getRasterSurface(layer.id)!;
    const area = surface.canvas.width * surface.canvas.height;
    expect(area).toBeLessThan(0.05 * 2048 * 2048);
    expect(alphaAt(getBuffer(layer.id)!, 1020, 1005)).toBeGreaterThan(0);
  });
});

