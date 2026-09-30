import type { RasterLayer, RasterStroke } from '../types';

/** Bounds in document coordinates; stroke offsets remain in buffer pixels. */
export function rasterStrokeBox(layer: RasterLayer, stroke: RasterStroke) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [ax, ay, bx, by, width] of stroke.segments) {
    const r = width / 2;
    x0 = Math.min(x0, ax - r, bx - r);
    y0 = Math.min(y0, ay - r, by - r);
    x1 = Math.max(x1, ax + r, bx + 0.01 + r);
    y1 = Math.max(y1, ay + r, by + r);
  }
  if (!Number.isFinite(x0)) return null;
  const kx = layer.width / layer.pxWidth, ky = layer.height / layer.pxHeight;
  return { x: layer.x + (x0 + stroke.x) * kx, y: layer.y + (y0 + stroke.y) * ky, w: (x1 - x0) * kx, h: (y1 - y0) * ky };
}

export function moveRasterStroke(layer: RasterLayer, id: string, dx: number, dy: number): RasterLayer {
  return { ...layer, paintStrokes: layer.paintStrokes?.map((s) => s.id === id
    ? { ...s, x: s.x + dx * layer.pxWidth / layer.width, y: s.y + dy * layer.pxHeight / layer.height }
    : s) };
}
