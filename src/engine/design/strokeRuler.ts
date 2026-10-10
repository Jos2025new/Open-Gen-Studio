import { setUi, useStore } from '../../store/store';

/*
 * Stroke rulers, as PaintTool SAI 2 has them: the Ruler tool places a guide on the page and, while it is shown, the
 * brush follows it. Straight: strokes run parallel to the guide from where they start (on the guide when they start
 * on it). Ellipse: strokes follow the ellipse concentric to the guide that passes through their start.
 */

export type RulerKind = 'line' | 'ellipse';
export interface StrokeRuler {
  docId: string;
  kind: RulerKind;
  /** Line: its two ends. Ellipse: two corners of its bounding box. Document px. */
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** Shown, and the brush follows it. */
  on: boolean;
}

type P = { x: number; y: number };
const get = () => useStore.getState().ui.strokeRuler ?? null;

export function setRuler(r: StrokeRuler | null): void {
  setUi({ strokeRuler: r });
}

/** The ruler the brush follows on this page, if any. */
export function activeRuler(docId: string): StrokeRuler | null {
  const r = get();
  return r && r.on && r.docId === docId && Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y) > 2 ? r : null;
}

// Where the stroke being painted started: parallel lines and concentric ellipses go through it.
let start: P | null = null;
let ratio = 1;

export function beginRulerStroke(docId: string, p: P): P {
  const r = activeRuler(docId);
  start = r ? p : null;
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

export function snap(r: StrokeRuler, p: P): P {
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
}
