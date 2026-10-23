import type { ShapeSpec, Stroke, VectorLayer } from '../types';
import { shapeBox, type Box } from './doc';
import { strokeReach } from './shapeLook';
import { localBox, toLocal } from './shapeTransform';
import { strokeBox } from './strokes';

/*
 * A click on a vector object lands on what it draws, not on the box around it: an ellipse's corners, the empty side
 * of a diagonal line or the inside of a curl are not the object. A few page px of slack keep thin lines easy to pick.
 * Paths keep their box (their exact area needs a canvas).
 */

const SLACK = 4;

const inBox = (b: Box | null, x: number, y: number) => !!b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

export function shapeHit(s: ShapeSpec, x: number, y: number): boolean {
  if (s.type === 'line') return segmentDistance(x, y, s.x, s.y, s.x + s.w, s.y + s.h) <= Math.max(SLACK, s.strokeWidth / 2);
  if (s.type === 'path') return inBox(shapeBox(s), x, y);
  // Rectangles and ellipses, turned or not: in their own coordinates, the stroke's reach included.
  const [lx, ly] = toLocal(s, x, y), b = localBox(s), r = strokeReach(s);
  const hw = Math.max(SLACK, b.w / 2 + r), hh = Math.max(SLACK, b.h / 2 + r), dx = lx - (b.x + b.w / 2), dy = ly - (b.y + b.h / 2);
  return s.type === 'ellipse' ? (dx / hw) ** 2 + (dy / hh) ** 2 <= 1 : Math.abs(dx) <= hw && Math.abs(dy) <= hh;
}

export function strokeHit(s: Stroke, x: number, y: number): boolean {
  if (!s.points.length) return inBox(strokeBox(s), x, y);
  const reach = s.size / 2 + SLACK, p = s.points;
  if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= reach;
  for (let i = 1; i < p.length; i++) if (segmentDistance(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= reach) return true;
  return false;
}

/** The vector object with this id is under the point (its own geometry, not its box). */
export function vectorObjectHit(l: VectorLayer, id: string, x: number, y: number): boolean {
  const shape = l.shapes.find((s) => s.id === id);
  if (shape) return shapeHit(shape, x, y);
  const stroke = l.strokes?.find((s) => s.id === id);
  return stroke ? strokeHit(stroke, x, y) : false;
}

/** Any of the layer's shapes or strokes is under the point. */
export function vectorLayerHit(l: VectorLayer, x: number, y: number): boolean {
  return l.shapes.some((s) => shapeHit(s, x, y)) || (l.strokes ?? []).some((s) => strokeHit(s, x, y));
}
