import type { ShapeSpec } from '../shapeSpec';
import { normalizePrim, starVertices, withPrim } from './primitives';
import { isWholeArc } from './shapeKinds';

/*
 * Handles of a primitive, in the shape's own (box) coordinates: each one sits where its parameter is, and dragging it
 * sets that parameter back. The unit circle fills the box (UNIT_BOX), so a point of the unit frame maps to the box
 * from its centre and half sizes. Outer radius: the box scales about its centre, so the top corner follows the
 * pointer (Inkscape's star radius). Inner radius, corner rounding, and the start and end angles of sector, arc and
 * chord: as in Inkscape's star and arc knots. Ctrl snaps an angle to 15°.
 */

export type PrimKnot = 'outer' | 'inner' | 'round' | 'from' | 'to';
export type Pt = [number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Centre and half sizes of the box, the frame the unit circle maps to. */
export function boxFrame(s: Pick<ShapeSpec, 'x' | 'y' | 'w' | 'h'>): { c: Pt; hw: number; hh: number } {
  return { c: [s.x + s.w / 2, s.y + s.h / 2], hw: Math.abs(s.w) / 2, hh: Math.abs(s.h) / 2 };
}
export const toBox = (s: ShapeSpec, u: Pt): Pt => { const f = boxFrame(s); return [f.c[0] + u[0] * f.hw, f.c[1] + u[1] * f.hh]; };
export const toUnit = (s: ShapeSpec, q: Pt): Pt => { const f = boxFrame(s); return [(q[0] - f.c[0]) / (f.hw || 1), (q[1] - f.c[1]) / (f.hh || 1)]; };
/** Unit point at an angle in degrees, clockwise from the top (the convention of prim.a0 and prim.a1). */
export const unitAt = (deg: number): Pt => { const r = ((deg - 90) * Math.PI) / 180; return [Math.cos(r), Math.sin(r)]; };
/** The angle of a unit point, in degrees clockwise from the top, 0–360. */
export const angleOf = (u: Pt): number => (((Math.atan2(u[1], u[0]) * 180) / Math.PI + 90) % 360 + 360) % 360;

const spanOf = (a0: number, a1: number) => { const d = (((a1 - a0) % 360) + 360) % 360; return d === 0 ? 360 : d; };
const isFullTurn = (p: { a0?: number; a1?: number }) => isWholeArc(p.a0 ?? 0, p.a1 ?? 270);

/** Where each handle of a primitive is, in box coordinates. Empty for a plain path. */
export function primKnots(s: ShapeSpec): Array<{ k: PrimKnot; p: Pt }> {
  if (!s.prim) return [];
  const p = normalizePrim(s.prim);
  if (p.kind === 'polygon' || p.kind === 'star') {
    const v = starVertices(p);
    const out: Array<{ k: PrimKnot; p: Pt }> = [{ k: 'outer', p: toBox(s, v[0]) }];
    if (p.kind === 'star') out.push({ k: 'inner', p: toBox(s, v[1]) });
    // Rounding sits on the edge from the top corner: a handle at least a little out, so it stays apart from the corner.
    const t = Math.max((p.round ?? 0) / 2, 0.15);
    out.push({ k: 'round', p: toBox(s, [v[0][0] + (v[1][0] - v[0][0]) * t, v[0][1] + (v[1][1] - v[0][1]) * t]) });
    return out;
  }
  // Equal angles draw the full circle: both handles would sit on one point, so only the start shows (the end appears once it leaves).
  if (isFullTurn(p)) return [{ k: 'from', p: toBox(s, unitAt(p.a0 ?? 0)) }];
  return [{ k: 'from', p: toBox(s, unitAt(p.a0 ?? 0)) }, { k: 'to', p: toBox(s, unitAt(p.a1 ?? 270)) }];
}

/**
 * The patch that moves a handle to the pointer `q` (box coordinates): the new parameter, or for the outer radius the
 * new box. Null when the shape has no parameters or the move is degenerate.
 */
export function primKnotDrag(s: ShapeSpec, k: PrimKnot, q: Pt, snap15 = false): Partial<ShapeSpec> | null {
  if (!s.prim) return null;
  const p = normalizePrim(s.prim);
  const v = starVertices(p);
  if (k === 'outer') {
    const f = boxFrame(s), c = f.c, dv = dist(toBox(s, v[0]), c);
    if (!(dv > 0)) return null;
    const m = clamp(dist(q, c) / dv, 0.02, 50);
    return { x: c[0] - (s.w * m) / 2, y: c[1] - (s.h * m) / 2, w: s.w * m, h: s.h * m };
  }
  const u = toUnit(s, q);
  if (k === 'inner') return withPrim(s, { inner: clamp(Math.hypot(u[0], u[1]), 0.1, 1) }) as Partial<ShapeSpec>;
  if (k === 'round') {
    const e: Pt = [v[1][0] - v[0][0], v[1][1] - v[0][1]], len2 = e[0] * e[0] + e[1] * e[1];
    const t = len2 ? ((u[0] - v[0][0]) * e[0] + (u[1] - v[0][1]) * e[1]) / len2 : 0;
    return withPrim(s, { round: 2 * clamp(t, 0, 0.5) }) as Partial<ShapeSpec>;
  }
  let deg = angleOf(u);
  if (snap15) deg = Math.round(deg / 15) * 15 % 360;
  // The span a0 → a1 is continuous except where the dragged handle crosses the other one (full circle ↔ sliver). A
  // move that would jump the span by more than half a turn stays on the side the shape was on: the handle stops at
  // the other one (full circle, or the thinnest slice) instead of the shape flipping.
  const a0 = p.a0 ?? 0, a1 = p.a1 ?? 270, other = k === 'from' ? a1 : a0;
  const now = spanOf(a0, a1), next = k === 'from' ? spanOf(deg, a1) : spanOf(a0, deg);
  if (Math.abs(next - now) > 180) deg = now > 180 ? other : (other + (k === 'from' ? -1 : 1) + 360) % 360;
  // Inkscape's side rule (shape-editor-knotholders.cpp:1328-1341, 1351-1355): a handle dragged well outside the ellipse
  // (x² + y² > 1.25) makes it a slice, well inside (< 0.75) an arc; the buffer between keeps the kind from flipping.
  // Chords keep their kind: Inkscape's own rule would turn them into slices.
  const r2 = u[0] * u[0] + u[1] * u[1];
  const kind = p.kind === 'chord' ? p.kind : r2 > 1.25 ? 'sector' : r2 < 0.75 ? 'arc' : p.kind;
  return withPrim(s, k === 'from' ? { a0: deg, kind } : { a1: deg, kind }) as Partial<ShapeSpec>;
}
