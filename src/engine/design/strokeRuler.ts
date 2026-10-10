import { setUi, useStore } from '../../store/store';

/*
 * Stroke rulers, as PaintTool SAI 2 has them: the Ruler tool places a guide on the page and, while it is shown, the
 * brush follows it. Straight: strokes run parallel to the guide from where they start (on the guide when they start
 * on it). Ellipse: strokes follow the ellipse concentric to the guide that passes through their start.
 * Perspective: one or two vanishing points; each stroke runs straight from its start toward the vanishing point
 * (or the vertical, or with one point the horizontal) that best matches its first few pixels, then keeps it.
 */

export type RulerKind = 'line' | 'ellipse' | 'perspective';
export interface StrokeRuler {
  docId: string;
  kind: RulerKind;
  /** Line: its two ends. Ellipse: two corners of its bounding box. Perspective: the vanishing points. Document px. */
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** Shown, and the brush follows it. */
  on: boolean;
  /** Perspective: one vanishing point (a) or two (a and b). */
  points?: 1 | 2;
}

type P = { x: number; y: number };
const get = () => useStore.getState().ui.strokeRuler ?? null;

export function setRuler(r: StrokeRuler | null): void {
  setUi({ strokeRuler: r });
}

/** The ruler the brush follows on this page, if any. */
export function activeRuler(docId: string): StrokeRuler | null {
  const r = get();
  // One vanishing point needs no second end; every other guide does.
  return r && r.on && r.docId === docId && ((r.kind === 'perspective' && r.points === 1) || Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y) > 2) ? r : null;
}

// Where the stroke being painted started: parallel lines and concentric ellipses go through it.
let start: P | null = null;
let ratio = 1;
// Perspective: the direction chosen for this stroke, once it has moved PERSPECTIVE_LOCK px.
let dir: P | null = null;
const PERSPECTIVE_LOCK = 4;

export function beginRulerStroke(docId: string, p: P): P {
  const r = activeRuler(docId);
  start = r ? p : null;
  dir = null;
  if (r?.kind === 'ellipse') {
    const { cx, cy, rx, ry } = ellipseOf(r);
    ratio = Math.max(1e-3, Math.hypot((p.x - cx) / rx, (p.y - cy) / ry));
    return snap(r, p);
  }
  return p;
}

/** The point the brush paints: on the ruler's path through the stroke's start (unchanged without a ruler). */
export function rulerPoint(docId: string, p: P): P {
  const r = activeRuler(docId);
  return r && start ? snap(r, p) : p;
}

function ellipseOf(r: StrokeRuler) {
  return { cx: (r.a.x + r.b.x) / 2, cy: (r.a.y + r.b.y) / 2, rx: Math.max(1, Math.abs(r.b.x - r.a.x) / 2), ry: Math.max(1, Math.abs(r.b.y - r.a.y) / 2) };
}

/** The directions a perspective stroke may take from `s`: toward each vanishing point, vertical, and (one point) horizontal. */
export function perspectiveDirections(r: StrokeRuler, s: P): P[] {
  const unit = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
  const vps = r.points === 1 ? [r.a] : [r.a, r.b];
  return [...vps.map((v) => unit(v.x - s.x, v.y - s.y)), { x: 0, y: 1 }, ...(r.points === 1 ? [{ x: 1, y: 0 }] : [])];
}

export function snap(r: StrokeRuler, p: P): P {
  if (r.kind === 'perspective') {
    const s = start ?? p;
    if (!dir) {
      const mx = p.x - s.x, my = p.y - s.y, m = Math.hypot(mx, my);
      if (m < PERSPECTIVE_LOCK) return s;
      dir = perspectiveDirections(r, s).reduce((best, d) => (Math.abs(d.x * mx + d.y * my) > Math.abs(best.x * mx + best.y * my) ? d : best));
    }
    const t = (p.x - s.x) * dir.x + (p.y - s.y) * dir.y;
    return { x: s.x + t * dir.x, y: s.y + t * dir.y };
  }
  if (r.kind === 'line') {
    const s = start ?? r.a, dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, len2 = dx * dx + dy * dy;
    const t = ((p.x - s.x) * dx + (p.y - s.y) * dy) / len2;
    return { x: s.x + t * dx, y: s.y + t * dy };
  }
  const { cx, cy, rx, ry } = ellipseOf(r), angle = Math.atan2((p.y - cy) / ry, (p.x - cx) / rx);
  return { x: cx + ratio * rx * Math.cos(angle), y: cy + ratio * ry * Math.sin(angle) };
}

/** For tests: forget the current stroke. */
export function endRulerStroke(): void {
  start = null;
  ratio = 1;
  dir = null;
}
