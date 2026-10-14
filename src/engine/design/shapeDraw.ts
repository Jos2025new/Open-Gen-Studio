import type { ShapeSpec, VectorShape } from '../types';

/* The shape a drag makes with the box tools (rectangle, ellipse, line): one place for its geometry and style, so the
   Stage only decides when a drag ends. Lines keep their direction (signed w and h); boxes are normalised. */

export interface DrawStyle {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
  rx?: number;
  ry?: number;
}

export function boxShape(id: string, tool: 'rect' | 'ellipse' | 'line', x0: number, y0: number, x1: number, y1: number, style: DrawStyle, look: Partial<ShapeSpec>): VectorShape {
  const line = tool === 'line';
  return {
    id,
    type: tool,
    x: line ? x0 : Math.min(x0, x1),
    y: line ? y0 : Math.min(y0, y1),
    w: line ? x1 - x0 : Math.abs(x1 - x0),
    h: line ? y1 - y0 : Math.abs(y1 - y0),
    fill: line ? null : style.fill,
    stroke: line ? style.stroke ?? style.fill ?? '#ffffff' : style.stroke,
    strokeWidth: line ? Math.max(1, style.strokeWidth) : style.stroke ? style.strokeWidth : 0,
    radius: tool === 'rect' ? style.radius : 0,
    ...look,
    ...(tool === 'rect' ? { rx: style.rx, ry: style.ry } : {}),
  };
}
