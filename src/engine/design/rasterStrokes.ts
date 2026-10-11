import type { RasterLayer, RasterStroke } from '../types';

// Saved segments do not change; translated/scaled layers reuse their local bounds. Dead geometry can be collected.
// A live stroke grows its array in place (brushStroke.ts push): the count is part of the key, so bounds read while
// painting are never served stale.
const localBounds = new WeakMap<RasterStroke['segments'], { n: number; x0: number; y0: number; x1: number; y1: number }>();

/** Bounds in document coordinates; stroke offsets remain in buffer pixels. */
export function rasterStrokeBox(layer: RasterLayer, stroke: RasterStroke) {
  let box = localBounds.get(stroke.segments);
  if (!box || box.n !== stroke.segments.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [ax, ay, bx, by, width] of stroke.segments) {
      const r = width / 2;
      x0 = Math.min(x0, ax - r, bx - r);
      y0 = Math.min(y0, ay - r, by - r);
      x1 = Math.max(x1, ax + r, bx + 0.01 + r);
      y1 = Math.max(y1, ay + r, by + r);
    }
    if (!Number.isFinite(x0)) return null;
    box = { n: stroke.segments.length, x0, y0, x1, y1 };
    localBounds.set(stroke.segments, box);
  }
  const { x0, y0, x1, y1 } = box;
  const kx = layer.width / layer.pxWidth, ky = layer.height / layer.pxHeight;
  return { x: layer.x + (x0 + stroke.x) * kx, y: layer.y + (y0 + stroke.y) * ky, w: (x1 - x0) * kx, h: (y1 - y0) * ky };
}

export function moveRasterStroke(layer: RasterLayer, id: string, dx: number, dy: number): RasterLayer {
  return { ...layer, paintStrokes: layer.paintStrokes?.map((s) => s.id === id
    ? { ...s, x: s.x + dx * layer.pxWidth / layer.width, y: s.y + dy * layer.pxHeight / layer.height }
    : s) };
}
