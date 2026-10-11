import type { ShapeSpec } from '../types';

/*
 * Rounded corners, stroke style and blur of a shape, with Inkscape's formulas (read from its source, master):
 * - corner knots: shape-editor-knotholders.cpp RectKnotHolderEntityRX/RY (knot_get, knot_set, knot_click);
 * - one radius set: the other copies it (sp-rect.cpp set_shape); scaling: compensateRxRy;
 * - blur %: filter-chemistry.cpp modify_filter_gaussian_blur_amount, radius = (b/100)² · (w + h) / 4, and
 *   stdDeviation = radius / descrim (1 here: shapes live in page px); filter margin 2.4σ (gaussian-blur.cpp).
 * `blur` is stored as σ in px, like Inkscape's stdDeviation, so it scales with the shape and never drifts.
 */

type Box = { x: number; y: number; w: number; h: number };
const K = 0.5522847498; // cubic Bézier quarter-circle constant (affine.ts uses the same)
export const BLUR_MARGIN = 2.4;
export const MITER_DEFAULT = 4;
/** Sharp corners: no radius at all (unset, as after Inkscape's Shift-click or «Make corners sharp»). */
export const SHARP: Partial<ShapeSpec> = { rx: undefined, ry: undefined, radius: 0 };

export function rectBox(s: Pick<ShapeSpec, 'x' | 'y' | 'w' | 'h'>): Box {
  return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
}

/** The corner radii as drawn: one set copies to the other (each capped at half its side); else the legacy radius. */
export function cornerRadii(s: Pick<ShapeSpec, 'w' | 'h' | 'radius' | 'rx' | 'ry'>): { rx: number; ry: number } {
  // Legacy `radius` stays a circular corner, capped by the shorter side (as it was always drawn).
  if (s.rx == null && s.ry == null) { const r = clamp(s.radius ?? 0, 0, Math.min(Math.abs(s.w), Math.abs(s.h)) / 2); return { rx: r, ry: r }; }
  const rx = s.rx ?? s.ry ?? 0, ry = s.ry ?? s.rx ?? 0;
  return { rx: clamp(rx, 0, Math.abs(s.w) / 2), ry: clamp(ry, 0, Math.abs(s.h) / 2) };
}

type PathSink = { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void; closePath(): void };

/** Trace a rectangle with elliptical corners (cubic Béziers) on a canvas or path; the one geometry for all uses. */
export function traceRoundRect(p: PathSink, b: Box, rx: number, ry: number, fromMid = false): void {
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  // Dashed: start and close in the middle of the top edge, never at a corner, where engines differ in how the
  // dash meets the closing join (review: Inkscape squared a corner Chromium rounded).
  if (fromMid) {
    const xm = (x0 + x1) / 2, r = rx > 0 && ry > 0;
    const kx = rx * K, ky = ry * K;
    p.moveTo(xm, y0);
    if (!r) { p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.lineTo(x0, y0); p.lineTo(xm, y0); p.closePath(); return; }
    p.lineTo(x1 - rx, y0); p.bezierCurveTo(x1 - rx + kx, y0, x1, y0 + ry - ky, x1, y0 + ry);
    p.lineTo(x1, y1 - ry); p.bezierCurveTo(x1, y1 - ry + ky, x1 - rx + kx, y1, x1 - rx, y1);
    p.lineTo(x0 + rx, y1); p.bezierCurveTo(x0 + rx - kx, y1, x0, y1 - ry + ky, x0, y1 - ry);
    p.lineTo(x0, y0 + ry); p.bezierCurveTo(x0, y0 + ry - ky, x0 + rx - kx, y0, x0 + rx, y0);
    p.lineTo(xm, y0); p.closePath(); return;
  }
  if (rx <= 0 || ry <= 0) { p.moveTo(x0, y0); p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.closePath(); return; }
  const kx = rx * K, ky = ry * K;
  p.moveTo(x0 + rx, y0);
  p.lineTo(x1 - rx, y0); p.bezierCurveTo(x1 - rx + kx, y0, x1, y0 + ry - ky, x1, y0 + ry);
  p.lineTo(x1, y1 - ry); p.bezierCurveTo(x1, y1 - ry + ky, x1 - rx + kx, y1, x1 - rx, y1);
  p.lineTo(x0 + rx, y1); p.bezierCurveTo(x0 + rx - kx, y1, x0, y1 - ry + ky, x0, y1 - ry);
  p.lineTo(x0, y0 + ry); p.bezierCurveTo(x0, y0 + ry - ky, x0 + rx - kx, y0, x0 + rx, y0);
  p.closePath();
}

/** The same rectangle as SVG path data (so it also survives rotation and skew). */
export function roundRectPath(b: Box, rx: number, ry: number, fromMid = false): string {
  const d: string[] = [];
  traceRoundRect({ moveTo: (x, y) => d.push(`M ${x} ${y}`), lineTo: (x, y) => d.push(`L ${x} ${y}`), bezierCurveTo: (...c) => d.push(`C ${c.join(' ')}`), closePath: () => d.push('Z') }, b, rx, ry, fromMid);
  return d.join(' ');
}

/** Where Inkscape puts the corner knots: Rx on the top edge, Ry on the right edge. */
export function cornerKnots(s: ShapeSpec): { rx: [number, number]; ry: [number, number] } {
  const b = rectBox(s), r = cornerRadii(s);
  return { rx: [b.x + b.w - r.rx, b.y], ry: [b.x + b.w, b.y + r.ry] };
}

/** Dragging the Rx knot to page x (Ctrl: both radii equal, capped by the shorter side). */
export function dragRx(s: ShapeSpec, px: number, lock: boolean): Pick<ShapeSpec, 'rx' | 'ry'> {
  const b = rectBox(s);
  if (lock) { const r = clamp(b.x + b.w - px, 0, Math.min(b.w, b.h) / 2); return { rx: r, ry: r }; }
  // Without Ctrl (or the lock) only Rx moves: Ry keeps the radius it shows now. With no rounding yet (Ry 0), Ry stays
  // unset and copies Rx, so the first drag rounds the corners at all (an Rx with Ry 0 draws sharp corners).
  const cur = cornerRadii(s);
  // Review: an explicit Ry 0 (typed in the bar) must not keep the corners sharp either: unset it.
  return { rx: clamp(b.x + b.w - px, 0, b.w / 2), ry: cur.ry > 0 ? cur.ry : undefined };
}

/** Dragging the Ry knot to page y (Inkscape's RectKnotHolderEntityRY::knot_set). */
export function dragRy(s: ShapeSpec, py: number, lock: boolean): Pick<ShapeSpec, 'rx' | 'ry'> {
  const b = rectBox(s), cur = cornerRadii(s);
  if (lock) { const r = clamp(py - b.y, 0, Math.min(b.w, b.h) / 2); return { rx: r, ry: r }; }
  // Without Ctrl (or the lock) only Ry moves: Rx keeps the radius it shows now (unset at 0, as above). With Rx unset or
  // 0, Inkscape caps Ry by the shorter side.
  const free = s.rx == null || s.rx === 0;
  return { rx: cur.rx > 0 ? cur.rx : undefined, ry: clamp(py - b.y, 0, free ? Math.min(b.w, b.h) / 2 : b.h / 2) };
}

/** Click on a knot: Shift makes the corners sharp; Ctrl copies this knot's radius to the other. */
export function clickKnot(s: ShapeSpec, knot: 'rx' | 'ry', mods: { shift: boolean; ctrl: boolean }): Partial<ShapeSpec> | null {
  // Shift: Inkscape removes both attributes, so a later drag of either knot starts from unset radii.
  if (mods.shift) return SHARP;
  if (!mods.ctrl) return null;
  const r = cornerRadii(s)[knot];
  return { rx: r, ry: r };
}

/** The topmost shape of a vector layer under a page point, if it has an edit mode (rectangle or ellipse). */
export function editableShapeAt<T extends ShapeSpec>(shapes: T[], x: number, y: number): T | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i], b = rectBox(s);
    // The topmost shape under the point decides: a path over a rectangle hides it (no edit mode through it).
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return s.type === 'rect' || s.type === 'ellipse' ? s : null;
  }
  return null;
}

/** Blur % (Inkscape's slider) to σ in px, and back. */
export function blurSigma(percent: number, w: number, h: number): number {
  const b = clamp(percent, 0, 100) / 100;
  return (b * b * (Math.abs(w) + Math.abs(h))) / 4;
}
export function blurPercent(sigma: number, w: number, h: number): number {
  const p = Math.abs(w) + Math.abs(h);
  return p > 0 && sigma > 0 ? clamp(100 * Math.sqrt((4 * sigma) / p), 0, 100) : 0;
}

/** The blur knots: on the box's top and right edges, pushed out by the blur's visible margin (2.4σ). */
export function blurKnots(s: ShapeSpec): { top: [number, number]; right: [number, number]; edgeTop: [number, number]; edgeRight: [number, number] } {
  const b = rectBox(s), m = BLUR_MARGIN * (s.blur ?? 0), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return { top: [cx, b.y - m], right: [b.x + b.w + m, cy], edgeTop: [cx, b.y], edgeRight: [b.x + b.w, cy] };
}
/** Dragging a blur knot: its distance out from the edge is 2.4σ. */
export function dragBlur(s: ShapeSpec, knot: 'top' | 'right', px: number, py: number): number {
  const b = rectBox(s);
  return Math.max(0, (knot === 'top' ? b.y - py : px - (b.x + b.w)) / BLUR_MARGIN);
}

/** Scaling a shape by (sx, sy): each radius with its own axis (compensateRxRy), σ and width by the mean scale. */
export function scaleLook(s: ShapeSpec, sx: number, sy: number): Partial<ShapeSpec> {
  const k = Math.sqrt(Math.abs(sx * sy)), out: Partial<ShapeSpec> = { radius: (s.radius ?? 0) * k };
  if (s.type === 'rect' && (s.rx != null || s.ry != null || s.radius)) {
    const one = s.rx == null || s.ry == null, r = Math.max(s.rx ?? 0, s.ry ?? 0, one ? s.radius ?? 0 : 0);
    out.rx = (one ? r : s.rx!) * Math.abs(sx);
    out.ry = (one ? r : s.ry!) * Math.abs(sy);
  }
  if (s.blur) out.blur = s.blur * k;
  return out;
}

/** Canvas stroke settings. Old shapes (no join/cap) keep the round look they always had. */
export function applyStrokeLook(ctx: CanvasRenderingContext2D, s: ShapeSpec, width: number): void {
  ctx.lineWidth = width;
  ctx.lineJoin = s.join ?? 'round';
  ctx.lineCap = s.cap ?? 'round';
  ctx.miterLimit = s.miter ?? MITER_DEFAULT;
  // Dashes are in stroke widths (Inkscape's default), so they keep their rhythm when the width changes.
  ctx.setLineDash(s.dash?.length ? s.dash.map((d) => Math.max(0, d) * width) : []);
  ctx.lineDashOffset = (s.dashOffset ?? 0) * width;
}

/** SVG stroke attributes beyond colour and width. */
export function strokeLookSvg(s: ShapeSpec, width: number): string {
  const dash = s.dash?.length ? ` stroke-dasharray="${s.dash.map((d) => r3(Math.max(0, d) * width)).join(' ')}"${s.dashOffset ? ` stroke-dashoffset="${r3(s.dashOffset * width)}"` : ''}` : '';
  const miter = (s.join ?? 'round') === 'miter' ? ` stroke-miterlimit="${r3(s.miter ?? MITER_DEFAULT)}"` : '';
  return ` stroke-linecap="${s.cap ?? 'round'}" stroke-linejoin="${s.join ?? 'round'}"${miter}${dash}${s.paintOrder === 'stroke' ? ' paint-order="stroke"' : ''}`;
}

/** How far the paint reaches past the geometric box: half the stroke, more at miter joins and square caps. */
export function strokeReach(s: ShapeSpec): number {
  if (!s.stroke || s.strokeWidth <= 0) return 0;
  const join = (s.join ?? 'round') === 'miter' ? Math.max(1, s.miter ?? MITER_DEFAULT) : 1, cap = (s.cap ?? 'round') === 'square' ? Math.SQRT2 : 1;
  return (s.strokeWidth / 2) * Math.max(join, cap);
}

/** The page area a blurred shape paints: its box, the stroke's reach and Inkscape's 2.4σ margin (never empty). */
export function blurRegion(s: ShapeSpec): Box {
  const b = rectBox(s), m = strokeReach(s) + BLUR_MARGIN * (s.blur ?? 0) + 1;
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
}

/** An SVG blur filter for one shape, in page units (a line has a zero-height box, so no bounding-box units). */
export function blurFilterSvg(id: string, s: ShapeSpec): string {
  const r = blurRegion(s);
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${r3(r.x)}" y="${r3(r.y)}" width="${r3(r.w)}" height="${r3(r.h)}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${r3(s.blur ?? 0)}"/></filter>`;
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function r3(v: number): number { return Math.round(v * 1000) / 1000; }
