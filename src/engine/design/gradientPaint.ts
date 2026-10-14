import type { GradientPaint, ShapeSpec } from '../shapeSpec';
import { IDENTITY, apply, invert, multiply, type Mat } from './matrix';
import { pathTransform } from './path';
import { shapeMatrix } from './shapeTransform';

/*
 * Editable gradients: a gradient is stored in page coordinates, and every shape paints it in its own coordinates
 * (the matrix its geometry is drawn through). The canvas and the SVG export use the same conversion, so the
 * gradient lands in the same place on screen, in PNG and in the SVG.
 */

/** Matrix from the shape's own coordinates to the page: its turn (rectangles, ellipses, paths) and a path's box. */
export function elementMatrix(s: ShapeSpec): Mat {
  if (s.type === 'path') {
    const t = pathTransform(s);
    const placed: Mat = [t.sx, 0, 0, t.sy, t.tx, t.ty];
    return s.rot ? multiply(shapeMatrix(s), placed) : placed;
  }
  return s.rot && (s.type === 'rect' || s.type === 'ellipse') ? shapeMatrix(s) : IDENTITY;
}

const rgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/** The gradient's points in the shape's own coordinates. */
function localPoints(g: GradientPaint, s: ShapeSpec) {
  const inv = invert(elementMatrix(s));
  const p1 = apply(inv, g.x1, g.y1), p2 = apply(inv, g.x2, g.y2);
  return { p1, p2 };
}

/** A canvas gradient for the shape being painted (call it with the shape's transform already set). */
export function gradientStyle(ctx: CanvasRenderingContext2D, g: GradientPaint, s: ShapeSpec): CanvasGradient {
  const { p1, p2 } = localPoints(g, s);
  const gr = g.kind === 'radial'
    ? ctx.createRadialGradient(p1[0], p1[1], 0, p1[0], p1[1], Math.max(1e-6, Math.hypot(p2[0] - p1[0], p2[1] - p1[1])))
    : ctx.createLinearGradient(p1[0], p1[1], p2[0], p2[1]);
  for (const st of g.stops) gr.addColorStop(Math.min(1, Math.max(0, st.offset)), rgba(st.color, st.alpha));
  return gr;
}

/** The SVG gradient element for one paint of a shape, in the shape's coordinates (userSpaceOnUse). */
export function gradientSvg(g: GradientPaint, s: ShapeSpec, id: string, xmlEscape: (v: string) => string): string {
  const { p1, p2 } = localPoints(g, s);
  const n = (v: number) => String(+v.toFixed(4));
  const stops = g.stops.map((st) => `<stop offset="${n(Math.min(1, Math.max(0, st.offset)))}" stop-color="${xmlEscape(st.color)}" stop-opacity="${n(st.alpha)}"/>`).join('');
  const head = `id="${id}" gradientUnits="userSpaceOnUse"`;
  return g.kind === 'radial'
    ? `<radialGradient ${head} cx="${n(p1[0])}" cy="${n(p1[1])}" r="${n(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]))}">${stops}</radialGradient>`
    : `<linearGradient ${head} x1="${n(p1[0])}" y1="${n(p1[1])}" x2="${n(p2[0])}" y2="${n(p2[1])}">${stops}</linearGradient>`;
}

/** A gradient spanning a page box: linear left to right through the middle; radial from the centre to the side. */
export function defaultGradient(kind: 'linear' | 'radial', box: { x: number; y: number; w: number; h: number }, from: string, to: string): GradientPaint {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const stops = [{ offset: 0, color: from, alpha: 1 }, { offset: 1, color: to, alpha: 1 }];
  return kind === 'radial'
    ? { kind, x1: cx, y1: cy, x2: cx + box.w / 2, y2: cy, stops }
    : { kind, x1: box.x, y1: cy, x2: box.x + box.w, y2: cy, stops };
}
