import { allVectorObjects } from './vectorMask';
import type { Layer, RasterLayer, ShapeSpec, Stroke, VectorLayer } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { mapPathShape } from './path';
import { cornerRadii, roundRectPath, scaleLook } from './shapeLook';
import { composeShape, toPage } from './shapeTransform';
import { apply, invert, isAxisAligned, lengthScale, multiply, type Mat } from './matrix';
import { getBuffer, setBuffer, composeRaster } from './raster';

/*
 * One affine transform (scale, rotate, skew, any mix; page coordinates) applied to what the Edit tool acts on:
 * the picked objects of a layer, or a whole layer. Points are moved where there are points (paths, Lineart,
 * painted strokes; rectangles and ellipses become paths once they stop being axis-aligned). Images and text keep
 * a matrix (Layer.transform), so they turn without losing quality. A painted layer's pixels are resampled once.
 */

const K = 0.5522847498; // cubic Bézier circle constant

/** Convert to path (Inkscape's Object to Path): a rectangle, ellipse or line as the same outline, turn included. One-way. */
export function shapeToPath<T extends ShapeSpec>(s: T): T {
  if (s.type === 'path') return s;
  const x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
  let d: string;
  if (s.type === 'line') d = `M ${x0} ${y0} L ${x1} ${y1}`;
  else if (s.type === 'ellipse') {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    d = `M ${cx + rx} ${cy} C ${cx + rx} ${cy + ry * K} ${cx + rx * K} ${cy + ry} ${cx} ${cy + ry} C ${cx - rx * K} ${cy + ry} ${cx - rx} ${cy + ry * K} ${cx - rx} ${cy} C ${cx - rx} ${cy - ry * K} ${cx - rx * K} ${cy - ry} ${cx} ${cy - ry} C ${cx + rx * K} ${cy - ry} ${cx + rx} ${cy - ry * K} ${cx + rx} ${cy} Z`;
  } else {
    // Rounded corners keep their look (elliptical when Rx ≠ Ry).
    const r = cornerRadii(s);
    d = roundRectPath({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }, r.rx, r.ry);
  }
  const box = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) || 1, h: Math.abs(y1 - y0) || 1 };
  const p = { ...s, type: 'path' as const, d, box0: box, ...box, radius: 0, rx: undefined, ry: undefined, rot: undefined };
  return (s.rot ? mapPathShape(p, (x, y) => toPage(s, x, y)) : p) as T;
}

export function transformShape<T extends ShapeSpec>(s: T, m: Mat): T {
  const k = lengthScale(m);
  if (s.type !== 'path' && !s.rot && isAxisAligned(m)) {
    const [x0, y0] = apply(m, s.x, s.y), [x1, y1] = apply(m, s.x + s.w, s.y + s.h);
    return { ...s, x: x0, y: y0, w: x1 - x0, h: y1 - y0, strokeWidth: s.strokeWidth * k, ...scaleLook(s, m[0], m[3]) };
  }
  // A rectangle or ellipse stays one when turned or skewed, as in Inkscape (shapeTransform.ts); a line stays a line.
  if (s.type === 'rect' || s.type === 'ellipse') return composeShape(s, m);
  if (s.type === 'line') { const [x0, y0] = apply(m, s.x, s.y), [x1, y1] = apply(m, s.x + s.w, s.y + s.h); return { ...s, x: x0, y: y0, w: x1 - x0, h: y1 - y0, strokeWidth: s.strokeWidth * k, ...(s.blur ? { blur: s.blur * k } : {}) }; }
  return { ...mapPathShape(s, (x, y) => apply(m, x, y)), strokeWidth: s.strokeWidth * k, ...(s.blur ? { blur: s.blur * k } : {}) };
}

export function transformStroke(s: Stroke, m: Mat): Stroke {
  return { ...s, size: s.size * lengthScale(m), points: s.points.map(([x, y, p]) => [...apply(m, x, y), p] as [number, number, number]) };
}

/** Page coordinates → a raster layer's buffer pixels. */
function pageToBuffer(l: RasterLayer): Mat {
  const kx = l.pxWidth / l.width, ky = l.pxHeight / l.height;
  const toLocal: Mat = l.transform ? invert(l.transform) : [1, 0, 0, 1, 0, 0];
  return multiply([kx, 0, 0, ky, -l.x * kx, -l.y * ky], toLocal);
}

/** The same transform, expressed in a raster layer's buffer pixels. */
function inBuffer(l: RasterLayer, m: Mat): Mat {
  const t = pageToBuffer(l);
  return multiply(t, multiply(m, invert(t)));
}

/** Pure part: vector content and painted strokes. `ids` = the picked objects; null = the whole layer. */
export function transformObjects(layer: Layer, ids: string[] | null, m: Mat): Layer {
  const on = (id: string) => !ids || ids.includes(id);
  if (layer.type === 'vector') {
    return {
      ...layer,
      ...(layer.pixelMask && allVectorObjects(layer, ids) ? { pixelMask: { ...layer.pixelMask, transform: multiply(m, layer.pixelMask.transform ?? [1, 0, 0, 1, 0, 0]) } } : {}),
      shapes: layer.shapes.map((s) => (on(s.id) ? transformShape(s, m) : s)),
      ...(layer.strokes ? { strokes: layer.strokes.map((s) => (on(s.id) ? transformStroke(s, m) : s)) } : {}),
    } as VectorLayer;
  }
  if (layer.type === 'raster') {
    const b = inBuffer(layer, m);
    const k = lengthScale(b);
    return {
      ...layer,
      paintStrokes: layer.paintStrokes?.map((s) => {
        if (!on(s.id)) return s;
        const segments = s.segments.map(([ax, ay, bx, by, w]) => {
          const [a0, a1] = apply(b, ax + s.x, ay + s.y), [b0, b1] = apply(b, bx + s.x, by + s.y);
          return [a0, a1, b0, b1, w * k] as [number, number, number, number, number];
        });
        return { ...s, x: 0, y: 0, segments };
      }),
    };
  }
  return layer;
}

/** A canvas redrawn through a transform (same size). */
function resampled(src: HTMLCanvasElement, b: Mat): HTMLCanvasElement {
  const out = createCanvas(src.width, src.height);
  const c = ctx2d(out);
  c.imageSmoothingQuality = 'high';
  c.setTransform(...b);
  c.drawImage(src, 0, 0);
  return out;
}

/**
 * Apply `m` to the layer (whole) or its picked objects, from `base` (the layer as it was when the gesture started,
 * with `buffers` its pixels then, so a drag never compounds). Returns the new layer; pixel buffers are set here.
 * `persist` false while dragging (the last frame is saved).
 */
export function transformLayer(base: Layer, ids: string[] | null, m: Mat, buffers: { main?: HTMLCanvasElement; paintBase?: HTMLCanvasElement }, persist: boolean): Layer {
  if (base.type === 'fx') return base;
  if (base.type === 'vector') return transformObjects(base, ids, m);
  if (base.type === 'text') return ids ? base : { ...base, transform: multiply(m, base.transform ?? [1, 0, 0, 1, 0, 0]) };
  // Raster.
  if (ids) {
    const next = transformObjects(base, ids, m) as RasterLayer;
    composeRaster(next, persist);
    return next;
  }
  if (base.sourceAssetId) return { ...base, transform: multiply(m, base.transform ?? [1, 0, 0, 1, 0, 0]) };
  // A painted layer: its pixels resampled through the transform, its strokes moved with them.
  const b = inBuffer(base, m);
  const next = transformObjects(base, null, m) as RasterLayer;
  if (base.paintBaseId && buffers.paintBase) {
    setBuffer(base.paintBaseId, resampled(buffers.paintBase, b), persist);
    composeRaster(next, persist);
  } else if (buffers.main) setBuffer(base.id, resampled(buffers.main, b), persist);
  return next;
}

/** The pixels a raster layer had when a gesture started (copy-on-write: no copy needed). */
export function gestureBuffers(l: Layer): { main?: HTMLCanvasElement; paintBase?: HTMLCanvasElement } {
  if (l.type !== 'raster') return {};
  return { main: getBuffer(l.id), paintBase: l.paintBaseId ? getBuffer(l.paintBaseId) : undefined };
}
