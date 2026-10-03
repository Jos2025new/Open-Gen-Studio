/*
 * 2D affine matrices, as SVG and canvas use them: [a, b, c, d, e, f] maps (x, y) to (a·x + c·y + e, b·x + d·y + f).
 * Images and text carry one (Layer.transform) the way Inkscape objects carry an SVG transform: rotated or skewed
 * without resampling their pixels. Everything made of points (paths, Lineart, painted strokes) has the transform
 * applied to its points instead.
 */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** m ∘ n: first n, then m. */
export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export const translation = (dx: number, dy: number): Mat => [1, 0, 0, 1, dx, dy];

/** Scale about a point. */
export function scaleAbout(sx: number, sy: number, cx: number, cy: number): Mat {
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
}

/** Rotate by `rad` (clockwise on screen, y down) about a point. */
export function rotateAbout(rad: number, cx: number, cy: number): Mat {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

/** Skew about a point: kx shifts x by kx·(y − cy); ky shifts y by ky·(x − cx). */
export function skewAbout(kx: number, ky: number, cx: number, cy: number): Mat {
  return [1, ky, kx, 1, -kx * cy, -ky * cx];
}

/** The axis-aligned box around a box mapped through m. */
export function mapBox(m: Mat, b: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const pts = [apply(m, b.x, b.y), apply(m, b.x + b.w, b.y), apply(m, b.x, b.y + b.h), apply(m, b.x + b.w, b.y + b.h)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Only scale and translation (axis-aligned shapes stay rectangles and ellipses under it). */
export function isAxisAligned(m: Mat): boolean {
  return Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
}

/** How much a length grows under m (for stroke widths). */
export function lengthScale(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}
