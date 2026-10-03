import { parsePath } from './path';

/* Shapes the user drags that are not boxes: a polygon in the dragged box, a curve and an arrow between the two
   points. They are saved as path shapes (page coordinates), so they move, scale, export and undo like the others. */

export type PathTool = 'polygon' | 'curve' | 'arrow';

const n = (v: number) => Math.round(v * 100) / 100;

/** Regular polygon with `sides` corners inscribed in the box, first corner at the top. */
export function polygonPath(x0: number, y0: number, x1: number, y1: number, sides: number): string {
  const k = Math.max(3, Math.min(12, Math.round(sides)));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  const pts = Array.from({ length: k }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / k;
    return `${n(cx + rx * Math.cos(a))} ${n(cy + ry * Math.sin(a))}`;
  });
  return `M ${pts[0]} ${pts.slice(1).map((p) => `L ${p}`).join(' ')} Z`;
}

/** A curve from start to end that bows to one side; `bend` is the bow as a share of the length (−1…1). */
export function curvePath(x0: number, y0: number, x1: number, y1: number, bend: number): string {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const nx = -(y1 - y0) / (len || 1), ny = (x1 - x0) / (len || 1);
  // A quadratic's middle sits halfway to its control point: double the offset so the bow is `bend × length`.
  const cx = (x0 + x1) / 2 + nx * bend * len * 2, cy = (y0 + y1) / 2 + ny * bend * len * 2;
  return `M ${n(x0)} ${n(y0)} Q ${n(cx)} ${n(cy)} ${n(x1)} ${n(y1)}`;
}

/** A straight arrow from start to end, its head sized to the stroke width. */
export function arrowPath(x0: number, y0: number, x1: number, y1: number, strokeWidth: number): string {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const head = Math.min(Math.hypot(x1 - x0, y1 - y0) / 2, Math.max(10, strokeWidth * 4));
  const a = ang + Math.PI - 0.45, b = ang + Math.PI + 0.45;
  return `M ${n(x0)} ${n(y0)} L ${n(x1)} ${n(y1)} M ${n(x1 + head * Math.cos(a))} ${n(y1 + head * Math.sin(a))} L ${n(x1)} ${n(y1)} L ${n(x1 + head * Math.cos(b))} ${n(y1 + head * Math.sin(b))}`;
}

export function toolPath(tool: PathTool, x0: number, y0: number, x1: number, y1: number, opts: { sides: number; bend: number; strokeWidth: number }): string {
  return tool === 'polygon' ? polygonPath(x0, y0, x1, y1, opts.sides) : tool === 'curve' ? curvePath(x0, y0, x1, y1, opts.bend) : arrowPath(x0, y0, x1, y1, opts.strokeWidth);
}

/** The path's own box (box0) and placement: the shape sits exactly where it was drawn. */
export function pathBox(d: string): { x: number; y: number; w: number; h: number } | null {
  const r = parsePath(d);
  if ('error' in r) return null;
  return { x: r.box.x, y: r.box.y, w: Math.max(1, r.box.w), h: Math.max(1, r.box.h) };
}
