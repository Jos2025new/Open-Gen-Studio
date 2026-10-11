import type { ShapeSpec } from '../types';
import { apply, lengthScale, type Mat } from './matrix';

/*
 * A turned or skewed rectangle or ellipse stays a rectangle or ellipse, as in Inkscape (sp-rect.cpp
 * SPRect::set_transform L385–442, sp-ellipse.cpp L494–530): scale and position go into x/y/w/h (and the radii,
 * each with its own axis); what is left (turn, skew) stays as a matrix, here `rot`, the linear part about the
 * shape's own centre. Knots, fields and formulas keep working in the shape's own (unturned) coordinates.
 */

type Box = { x: number; y: number; w: number; h: number };
const EPS = 1e-9;

/** The shape's own box, sides positive. */
export function localBox(s: Pick<ShapeSpec, 'x' | 'y' | 'w' | 'h'>): Box {
  return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
}

/** The full matrix from the shape's own coordinates to the page: about its centre, then `rot`. */
export function shapeMatrix(s: ShapeSpec): Mat {
  const b = localBox(s), cx = b.x + b.w / 2, cy = b.y + b.h / 2, [a, bb, c, d] = s.rot ?? [1, 0, 0, 1];
  return [a, bb, c, d, cx - a * cx - c * cy, cy - bb * cx - d * cy];
}

/** Own coordinates → page. */
export function toPage(s: ShapeSpec, x: number, y: number): [number, number] {
  return s.rot ? apply(shapeMatrix(s), x, y) : [x, y];
}

/** Page → own coordinates. */
export function toLocal(s: ShapeSpec, x: number, y: number): [number, number] {
  if (!s.rot) return [x, y];
  const b = localBox(s), cx = b.x + b.w / 2, cy = b.y + b.h / 2, [a, bb, c, d] = s.rot, det = a * d - bb * c || EPS;
  const dx = x - cx, dy = y - cy;
  return [cx + (d * dx - c * dy) / det, cy + (-bb * dx + a * dy) / det];
}

/** The page box around what the shape covers (a turned ellipse: its exact extent, not its corners'). */
export function pageBox(s: ShapeSpec): Box {
  const b = localBox(s);
  if (!s.rot) return b;
  const [a, bb, c, d] = s.rot, cx = b.x + b.w / 2, cy = b.y + b.h / 2, hw = b.w / 2, hh = b.h / 2;
  const ex = s.type === 'ellipse' ? Math.hypot(a * hw, c * hh) : Math.abs(a * hw) + Math.abs(c * hh);
  const ey = s.type === 'ellipse' ? Math.hypot(bb * hw, d * hh) : Math.abs(bb * hw) + Math.abs(d * hh);
  return { x: cx - ex, y: cy - ey, w: 2 * ex, h: 2 * ey };
}

/**
 * Lay a page transform on a rectangle or ellipse, keeping it one (Inkscape's set_transform): the new linear part's
 * column lengths become the scale of the sides (and of each radius); what remains (turn, skew) is `rot`. A plain
 * scale or turn by quarters may leave `rot` as the identity, then it is dropped.
 */
export function composeShape<T extends ShapeSpec>(s: T, m: Mat): T {
  const b = localBox(s), [a0, b0, c0, d0] = s.rot ?? [1, 0, 0, 1];
  const A = m[0] * a0 + m[2] * b0, B = m[1] * a0 + m[3] * b0, C = m[0] * c0 + m[2] * d0, D = m[1] * c0 + m[3] * d0;
  const sw = Math.hypot(A, B) || EPS, sh = Math.hypot(C, D) || EPS;
  const rot: [number, number, number, number] = [A / sw, B / sw, C / sh, D / sh];
  const [cx, cy] = apply(m, b.x + b.w / 2, b.y + b.h / 2), w = b.w * sw, h = b.h * sh, k = lengthScale(m);
  const plain = Math.abs(rot[0] - 1) < EPS && Math.abs(rot[1]) < EPS && Math.abs(rot[2]) < EPS && Math.abs(rot[3] - 1) < EPS;
  // Radii follow their own axis (sp-rect.cpp L418–424); a legacy radius becomes both (compensateRxRy).
  const r = s.type === 'rect' && (s.rx != null || s.ry != null || s.radius)
    ? { rx: (s.rx ?? s.ry ?? s.radius) * sw, ry: (s.ry ?? s.rx ?? s.radius) * sh, radius: s.radius * Math.sqrt(sw * sh) } : {};
  return {
    ...s, x: cx - w / 2, y: cy - h / 2, w, h, ...r,
    strokeWidth: s.strokeWidth * k, ...(s.blur ? { blur: s.blur * k } : {}), rot: plain ? undefined : rot,
  };
}
