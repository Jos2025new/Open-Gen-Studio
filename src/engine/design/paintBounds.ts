import type { RasterLayer } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { getBuffer, setBuffer } from './raster';

/** Extend over the page and all existing pixels. Buffers stay copy-on-write for undo. */
export function rebasePaintPixels(layer: RasterLayer, page: { width: number; height: number }): RasterLayer | null {
  const buf = getBuffer(layer.id);
  if (!buf) return null;
  const base = layer.paintBaseId ? getBuffer(layer.paintBaseId) : undefined;
  if (layer.paintBaseId && !base) return null;
  if (Number.isInteger(layer.x) && Number.isInteger(layer.y) && layer.x <= 0 && layer.y <= 0 && layer.x + layer.width >= page.width && layer.y + layer.height >= page.height && layer.width === buf.width && layer.height === buf.height) return null;
  const x = Math.floor(Math.min(0, layer.x)), y = Math.floor(Math.min(0, layer.y));
  const width = Math.ceil(Math.max(page.width, layer.x + layer.width)) - x;
  const height = Math.ceil(Math.max(page.height, layer.y + layer.height)) - y;
  const dx = layer.x - x, dy = layer.y - y;
  const expand = (src: HTMLCanvasElement) => {
    const out = createCanvas(width, height);
    ctx2d(out).drawImage(src, dx, dy, layer.width, layer.height);
    return out;
  };
  setBuffer(layer.id, expand(buf));
  // Pixel-for-pixel expansion keeps strokes editable; a scaled bake consolidates the displayed pixels.
  const editable = base && layer.width === buf.width && layer.height === buf.height;
  if (editable) setBuffer(layer.paintBaseId!, expand(base));
  return { ...layer, x, y, width, height, pxWidth: width, pxHeight: height,
    paintBaseId: editable ? layer.paintBaseId : undefined,
    paintStrokes: editable ? layer.paintStrokes?.map(s => ({ ...s, x: s.x + dx, y: s.y + dy })) : undefined,
    rev: layer.rev + 1 };
}
