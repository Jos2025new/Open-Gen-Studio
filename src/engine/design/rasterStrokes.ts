import type { RasterLayer, RasterStroke } from '../types';
import { apply, invert } from './matrix';

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
  const local = { x: layer.x + (x0 + stroke.x) * kx, y: layer.y + (y0 + stroke.y) * ky, w: (x1 - x0) * kx, h: (y1 - y0) * ky };
  // Strokes live in the layer's own pixels; a shifted, turned or flipped layer shows them elsewhere on the page.
  if (!layer.transform) return local;
  const pts = [[local.x, local.y], [local.x + local.w, local.y], [local.x, local.y + local.h], [local.x + local.w, local.y + local.h]].map(([x, y]) => apply(layer.transform!, x, y));
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
}

export function moveRasterStroke(layer: RasterLayer, id: string, dx: number, dy: number): RasterLayer {
  // A page drag, taken back into the layer's own pixels when the layer is shown through a transform.
  if (layer.transform) {
    const inv = invert(layer.transform), [ox, oy] = apply(inv, 0, 0), [tx, ty] = apply(inv, dx, dy);
    dx = tx - ox; dy = ty - oy;
  }
  return { ...layer, paintStrokes: layer.paintStrokes?.map((s) => s.id === id
    ? { ...s, x: s.x + dx * layer.pxWidth / layer.width, y: s.y + dy * layer.pxHeight / layer.height }
    : s) };
}
