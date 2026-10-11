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
export function traceRoundRect(p: PathSink, b: Box, rx: number, ry: number): void {
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
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
export function roundRectPath(b: Box, rx: number, ry: number): string {
  const d: string[] = [];
  traceRoundRect({ moveTo: (x, y) => d.push(`M ${x} ${y}`), lineTo: (x, y) => d.push(`L ${x} ${y}`), bezierCurveTo: (...c) => d.push(`C ${c.join(' ')}`), closePath: () => d.push('Z') }, b, rx, ry);
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
  // Ry unset stays unset (it copies Rx, as in Inkscape); a legacy radius becomes Ry.
  return { rx: clamp(b.x + b.w - px, 0, b.w / 2), ry: s.ry ?? (s.rx == null && s.radius ? cornerRadii(s).ry : undefined) };
}

/** Dragging the Ry knot to page y. With no Rx yet, it stays a circle-cornered square limit, as in Inkscape. */
export function dragRy(s: ShapeSpec, py: number, lock: boolean): Pick<ShapeSpec, 'rx' | 'ry'> {
  const b = rectBox(s), cur = cornerRadii(s);
  if (lock) { const r = clamp(py - b.y, 0, Math.min(b.w, b.h) / 2); return { rx: r, ry: r }; }
  if (!cur.rx) { const r = clamp(py - b.y, 0, Math.min(b.w, b.h) / 2); return { rx: r, ry: r }; }
  return { rx: cur.rx, ry: clamp(py - b.y, 0, b.h / 2) };
}

/** Click on a knot: Shift makes the corners sharp; Ctrl copies this knot's radius to the other. */
export function clickKnot(s: ShapeSpec, knot: 'rx' | 'ry', mods: { shift: boolean; ctrl: boolean }): Partial<ShapeSpec> | null {
  if (mods.shift) return { rx: 0, ry: 0, radius: 0 };
  if (!mods.ctrl) return null;
  const r = cornerRadii(s)[knot];
  return { rx: r, ry: r };
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

/** Canvas blur: σ is in page px; the canvas filter works in device px, so it follows the current scale. */
export function blurFilter(ctx: CanvasRenderingContext2D, sigma: number | undefined): string {
  if (!sigma || sigma <= 0) return 'none';
  const m = ctx.getTransform();
  return `blur(${sigma * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))}px)`;
}

/** SVG stroke attributes beyond colour and width. */
export function strokeLookSvg(s: ShapeSpec, width: number): string {
  const dash = s.dash?.length ? ` stroke-dasharray="${s.dash.map((d) => r3(Math.max(0, d) * width)).join(' ')}"${s.dashOffset ? ` stroke-dashoffset="${r3(s.dashOffset * width)}"` : ''}` : '';
  const miter = (s.join ?? 'round') === 'miter' ? ` stroke-miterlimit="${r3(s.miter ?? MITER_DEFAULT)}"` : '';
  return ` stroke-linecap="${s.cap ?? 'round'}" stroke-linejoin="${s.join ?? 'round'}"${miter}${dash}${s.paintOrder === 'stroke' ? ' paint-order="stroke"' : ''}`;
}

/** An SVG blur filter for one shape, with Inkscape's 2.4σ margin around its box (as fractions of the box). */
export function blurFilterSvg(id: string, s: ShapeSpec): string {
  const b = rectBox(s), sg = s.blur ?? 0, m = BLUR_MARGIN * sg;
  const fx = b.w ? m / b.w : 0, fy = b.h ? m / b.h : 0;
  return `<filter id="${id}" x="${r3(-fx)}" y="${r3(-fy)}" width="${r3(1 + 2 * fx)}" height="${r3(1 + 2 * fy)}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${r3(sg)}"/></filter>`;
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function r3(v: number): number { return Math.round(v * 1000) / 1000; }
