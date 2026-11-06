import { rectPoints } from './pixelSelection';

/* The outlines a dragged selection can take (page coordinates). Pure, so the rules are testable without a canvas. */

export type Pt = { x: number; y: number };
export type Outline = Array<[number, number]>;
export interface BoxKeys { /** Shift: a square (or circle). */ square?: boolean; /** Alt: grow from the first point as the centre. */ centre?: boolean }

/** Largest gap, in page pixels, between an ellipse and the polygon that stands for it. */
const ELLIPSE_TOLERANCE = 0.2;

/** The corners of the box dragged from `start` to `cur`: Shift squares it (the longer side wins), Alt makes `start` the centre. */
export function boxCorners(start: Pt, cur: Pt, keys: BoxKeys = {}): { x0: number; y0: number; x1: number; y1: number } {
  let dx = cur.x - start.x, dy = cur.y - start.y;
  if (keys.square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * s;
    dy = (dy < 0 ? -1 : 1) * s;
  }
  return keys.centre ? { x0: start.x - dx, y0: start.y - dy, x1: start.x + dx, y1: start.y + dy } : { x0: start.x, y0: start.y, x1: start.x + dx, y1: start.y + dy };
}

/** An ellipse as a polygon fine enough to stay within ELLIPSE_TOLERANCE at any zoom; the four extremes are always vertices. */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number): Outline {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  const r = Math.max(rx, ry);
  const raw = r > ELLIPSE_TOLERANCE ? Math.ceil(Math.PI / Math.acos(1 - ELLIPSE_TOLERANCE / r)) : 24;
  const n = Math.ceil(Math.min(720, Math.max(24, raw)) / 4) * 4;
  return Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)] as [number, number]);
}

/** The outline of a dragged rectangle or ellipse, and its size (what the live readout shows; with Alt, the whole box). */
export function boxOutline(shape: 'rect' | 'ellipse', start: Pt, cur: Pt, keys: BoxKeys = {}): { points: Outline; w: number; h: number } {
  const { x0, y0, x1, y1 } = boxCorners(start, cur, keys);
  const points = shape === 'ellipse' ? ellipsePoints(x0, y0, x1, y1) : rectPoints(x0, y0, x1, y1);
  return { points, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** Pulls `p` onto the nearest 45-degree step around `from` (the polygon's Shift). */
export function snapAngle(from: Pt, p: Pt): Pt {
  const dx = p.x - from.x, dy = p.y - from.y, len = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}
