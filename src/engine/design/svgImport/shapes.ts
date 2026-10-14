import type { BlendMode, ShapeSpec } from '../../types';
import { lengthScale, type Mat } from '../matrix';
import { transformShape } from '../affine';
import { MAX_PATH_LENGTH } from '../path';
import { pageBox } from '../shapeTransform';
import { strokeReach, BLUR_MARGIN } from '../shapeLook';
import { normalizePath } from './pathData';
import { importGradient } from './gradients';
import { numbers, parseLength } from './transforms';
import { parseOpacity, parsePaint, type Paint, type Style } from './styles';

/*
 * One SVG basic shape or path as an editable app shape: fill, stroke and its look, fill/stroke opacity, evenodd,
 * the one-primitive Gaussian blur Inkscape writes, and the transform (applied to the geometry or kept as the
 * shape's own turn: affine.ts transformShape, the same rule as the Edit tool). What the model cannot hold (paint
 * servers, clip-path, mask, other filters, markers) is reported as a reason so the caller rasterizes the element.
 */

type Box = { x: number; y: number; w: number; h: number };
export interface ShapeCtx { ctm: Mat; ids: Map<string, Element>; vw: number; vh: number; fontSize: number }
export type ShapeOutcome =
  | { ok: true; shape: ShapeSpec; opacity: number; blend: BlendMode }
  | { ok: false; reasons: string[]; hint: Box }
  | { ok: null };

export const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const BLENDS = new Set<string>(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'soft-light', 'hard-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
export const blendOf = (style: Style): BlendMode => (BLENDS.has(style['mix-blend-mode'] ?? '') ? (style['mix-blend-mode'] as BlendMode) : 'normal');

function serverReason(p: Paint, ids: Map<string, Element>): string | null {
  if (p.kind !== 'ref') return null;
  const t = ids.get(p.id)?.localName;
  if (!t) return null; // a missing server paints nothing
  return /gradient/i.test(t) ? 'gradient' : t === 'pattern' ? 'pattern' : 'paint server';
}

/** σ of a filter made of a single feGaussianBlur with equal deviations (Inkscape's Blur slider); null for none, 'other' otherwise. */
export function blurOf(style: Style, ids: Map<string, Element>): number | null | 'other' {
  const f = (style.filter ?? '').trim();
  if (!f || f === 'none') return null;
  const m = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/.exec(f);
  const el = m ? ids.get(m[1]) : undefined;
  if (!el || el.localName !== 'filter') return 'other';
  const kids = Array.from(el.children).filter((c) => c.localName !== 'desc' && c.localName !== 'title');
  if (kids.length !== 1 || kids[0].localName !== 'feGaussianBlur') return 'other';
  const sd = numbers(kids[0].getAttribute('stdDeviation') ?? '0');
  if (!sd.length || sd.length > 2 || (sd.length === 2 && sd[0] !== sd[1]) || sd.some((v) => v < 0)) return 'other';
  return sd[0] > 0 ? sd[0] : null;
}

export function buildShape(el: Element, style: Style, c: ShapeCtx): ShapeOutcome {
  const tag = el.localName;
  const len = (name: string, ref: number, fallback = 0) => parseLength(el.getAttribute(name), ref, c.fontSize) ?? fallback;
  const reasons: string[] = [];
  const fillPaint = parsePaint(style.fill ?? '#000000', style.color), strokePaint = parsePaint(style.stroke, style.color);
  // A gradient the editor can hold is kept as an editable paint (gradients.ts); any other server is rasterized.
  const fillGrad = fillPaint.kind === 'ref' ? importGradient(fillPaint.id, c) : null;
  const strokeGrad = strokePaint.kind === 'ref' ? importGradient(strokePaint.id, c) : null;
  for (const r of [fillGrad ? null : serverReason(fillPaint, c.ids), strokeGrad ? null : serverReason(strokePaint, c.ids)]) if (r && !reasons.includes(r)) reasons.push(r);
  const blur = blurOf(style, c.ids);
  if (blur === 'other') reasons.push('filter');
  if (style['clip-path'] && style['clip-path'] !== 'none') reasons.push('clip-path');
  if (style.mask && style.mask !== 'none') reasons.push('mask');
  if (tag !== 'rect' && tag !== 'circle' && tag !== 'ellipse' && ['marker-start', 'marker-mid', 'marker-end'].some((k) => style[k] && style[k] !== 'none')) reasons.push('marker');

  const sw = Math.max(0, parseLength(style['stroke-width'], Math.hypot(c.vw, c.vh) / Math.SQRT2, c.fontSize) ?? 1);
  const fillOk = fillPaint.kind === 'color', strokeOk = strokePaint.kind === 'color';
  const fo = parseOpacity(style['fill-opacity']) * (fillPaint.kind === 'color' ? fillPaint.alpha : 1);
  const so = parseOpacity(style['stroke-opacity']) * (strokePaint.kind === 'color' ? strokePaint.alpha : 1);
  const join = /bevel/.test(style['stroke-linejoin'] ?? '') ? 'bevel' : style['stroke-linejoin'] === 'round' ? 'round' : 'miter';
  const cap = style['stroke-linecap'] === 'round' ? 'round' : style['stroke-linecap'] === 'square' ? 'square' : 'butt';
  const miter = parseFloat(style['stroke-miterlimit'] ?? '');
  const dashes = style['stroke-dasharray'] && style['stroke-dasharray'] !== 'none' ? numbers(style['stroke-dasharray']).map((v) => Math.max(0, v)) : [];
  const look: Partial<ShapeSpec> = {
    join, cap, ...(Number.isFinite(miter) && miter >= 1 ? { miter } : {}),
    ...(dashes.length && dashes.some((v) => v > 0) && sw > 0 ? { dash: dashes.map((v) => v / sw), ...(parseLength(style['stroke-dashoffset']) ? { dashOffset: parseLength(style['stroke-dashoffset'])! / sw } : {}) } : {}),
    ...(/^\s*stroke/.test(style['paint-order'] ?? '') ? { paintOrder: 'stroke' as const } : {}),
    ...(style['fill-rule'] === 'evenodd' ? { fillRule: 'evenodd' as const } : {}),
    ...(fo < 1 ? { fillOpacity: fo } : {}), ...(so < 1 ? { strokeOpacity: so } : {}),
    ...(typeof blur === 'number' ? { blur } : {}),
  };
  const base = { fill: fillOk ? (fillPaint as { color: string }).color : null, stroke: strokeOk ? (strokePaint as { color: string }).color : null, strokeWidth: sw, radius: 0, ...look, ...(fillGrad ? { fillGradient: fillGrad } : {}), ...(strokeGrad ? { strokeGradient: strokeGrad } : {}) };
  const k = lengthScale(c.ctm);
  if (!(k > 0)) return { ok: null };

  let shape: ShapeSpec;
  if (tag === 'rect') {
    const w = len('width', c.vw), h = len('height', c.vh);
    if (!(w > 0 && h > 0)) return { ok: null };
    const rxA = el.hasAttribute('rx') ? len('rx', c.vw) : null, ryA = el.hasAttribute('ry') ? len('ry', c.vh) : null;
    const rx = rxA ?? ryA, ry = ryA ?? rxA;
    shape = transformShape({ type: 'rect', x: len('x', c.vw), y: len('y', c.vh), w, h, ...base, ...(rx != null && rx > 0 ? { rx, ry: ry ?? rx } : {}) } as ShapeSpec, c.ctm);
  } else if (tag === 'circle' || tag === 'ellipse') {
    const r = len('r', Math.hypot(c.vw, c.vh) / Math.SQRT2);
    const rxA = tag === 'circle' ? r : el.hasAttribute('rx') ? len('rx', c.vw) : null, ryA = tag === 'circle' ? r : el.hasAttribute('ry') ? len('ry', c.vh) : null;
    const rx = rxA ?? ryA ?? 0, ry = ryA ?? rxA ?? 0;
    if (!(rx > 0 && ry > 0)) return { ok: null };
    const cx = len('cx', c.vw), cy = len('cy', c.vh);
    shape = transformShape({ type: 'ellipse', x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry, ...base } as ShapeSpec, c.ctm);
  } else if (tag === 'line') {
    const x1 = len('x1', c.vw), y1 = len('y1', c.vh);
    shape = transformShape({ type: 'line', x: x1, y: y1, w: len('x2', c.vw) - x1, h: len('y2', c.vh) - y1, ...base, fill: null } as ShapeSpec, c.ctm);
  } else {
    let d = el.getAttribute('d') ?? '';
    if (tag === 'polyline' || tag === 'polygon') {
      const n = numbers(el.getAttribute('points'));
      if (n.length < 4) return { ok: null };
      d = Array.from({ length: Math.floor(n.length / 2) }, (_, i) => `${i ? 'L' : 'M'} ${n[2 * i]} ${n[2 * i + 1]}`).join(' ') + (tag === 'polygon' ? ' Z' : '');
    }
    const p = normalizePath(d, c.ctm);
    if (!p) return { ok: null };
    if (p.d.length > MAX_PATH_LENGTH) reasons.push('long path');
    const box = { x: p.box.x, y: p.box.y, w: Math.max(1, p.box.w), h: Math.max(1, p.box.h) };
    shape = { type: 'path', d: p.d, box0: box, ...box, ...base, strokeWidth: sw * k, ...(typeof blur === 'number' ? { blur: blur * k } : {}) } as ShapeSpec;
  }
  if (reasons.length) {
    const b = pageBox(shape), m = strokeReach(shape) + BLUR_MARGIN * (shape.blur ?? 0) + 1;
    return { ok: false, reasons, hint: { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m } };
  }
  return { ok: true, shape, opacity: parseOpacity(style.opacity), blend: blendOf(style) };
}
