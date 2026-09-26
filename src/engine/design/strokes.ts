import { getStroke, getStrokePoints, type StrokeOptions } from 'perfect-freehand';
import { uid } from '../../lib/id';
import type { Stroke, StrokeStyle } from '../types';
import type { Box } from './doc';

/*
 * Editable pressure strokes. A stroke keeps its gesture (points with pressure) and its style; the outline is
 * computed from them (perfect-freehand) and cached per stroke object. Strokes are replaced, never mutated,
 * so an edit makes a new object and the old cache entry simply goes away with it.
 */

export const DEFAULT_STROKE_STYLE: StrokeStyle = {
  color: '#ffffff',
  size: 8,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  taperStart: 0,
  taperEnd: 0,
  opacity: 1,
};

export function strokeOptions(s: Stroke, last = true): StrokeOptions {
  return {
    size: s.size,
    thinning: s.thinning,
    smoothing: s.smoothing,
    streamline: s.streamline,
    simulatePressure: s.simulatePressure,
    start: { taper: s.taperStart, cap: true },
    end: { taper: s.taperEnd, cap: true },
    last,
  };
}

const outlines = new WeakMap<Stroke, { outline: number[][]; path: string }>();

function computed(s: Stroke): { outline: number[][]; path: string } {
  let c = outlines.get(s);
  if (!c) {
    const outline = getStroke(s.points, strokeOptions(s));
    c = { outline, path: outlinePath(outline) };
    outlines.set(s, c);
  }
  return c;
}

/** Outline polygon of a finished stroke. */
export function strokeOutline(s: Stroke): number[][] {
  return computed(s).outline;
}

/** SVG path data of the outline (filled, nonzero), smoothed with quadratic curves between midpoints. */
export function strokePath(s: Stroke): string {
  return computed(s).path;
}

const r = (v: number) => Math.round(v * 100) / 100;

export function outlinePath(points: number[][]): string {
  const len = points.length;
  if (len < 4) return '';
  const avg = (a: number, b: number) => (a + b) / 2;
  let a = points[0];
  let b = points[1];
  const c = points[2];
  let d = `M${r(a[0])},${r(a[1])} Q${r(b[0])},${r(b[1])} ${r(avg(b[0], c[0]))},${r(avg(b[1], c[1]))} T`;
  for (let i = 2; i < len - 1; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${r(avg(a[0], b[0]))},${r(avg(a[1], b[1]))} `;
  }
  return `${d}Z`;
}

/** Centerline samples with pressure, running length and direction (for texture stamping). */
export function strokeSamples(s: Stroke) {
  return getStrokePoints(s.points, strokeOptions(s));
}

export function strokeBox(s: Stroke): Box | null {
  const o = strokeOutline(s);
  const pts = o.length ? o : s.points;
  if (!pts.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function newStroke(points: Array<[number, number, number]>, style: StrokeStyle, simulatePressure: boolean): Stroke {
  return { id: uid('stk'), ...style, points, simulatePressure };
}

export function translateStroke(s: Stroke, dx: number, dy: number): Stroke {
  return { ...s, points: s.points.map(([x, y, p]) => [x + dx, y + dy, p]) };
}

/** Scale about an anchor; width and tapers follow the average scale so the line keeps its look. */
export function scaleStroke(s: Stroke, sx: number, sy: number, ax: number, ay: number): Stroke {
  const k = Math.sqrt(Math.abs(sx * sy));
  return {
    ...s,
    points: s.points.map(([x, y, p]) => [ax + (x - ax) * sx, ay + (y - ay) * sy, p]),
    size: Math.max(0.5, s.size * k),
    taperStart: s.taperStart * k,
    taperEnd: s.taperEnd * k,
  };
}

/** Index of the stroke point nearest to (x, y) within `tolerance`, across strokes (last drawn wins ties). */
export function nearestPoint(strokes: Stroke[], x: number, y: number, tolerance: number): { stroke: number; point: number } | null {
  let best: { stroke: number; point: number } | null = null;
  let bestD = tolerance;
  strokes.forEach((s, si) =>
    s.points.forEach(([px, py], pi) => {
      const d = Math.hypot(px - x, py - y);
      if (d <= bestD) {
        bestD = d;
        best = { stroke: si, point: pi };
      }
    }),
  );
  return best;
}

/**
 * Drag one point of the path; neighbours within `radius` (measured along the path) follow with a smooth
 * falloff, so the curve bends instead of kinking. Pressure is kept.
 */
export function bendStroke(s: Stroke, index: number, dx: number, dy: number, radius: number): Stroke {
  const pts = s.points;
  const along = new Array<number>(pts.length).fill(Infinity);
  along[index] = 0;
  for (let i = index + 1; i < pts.length; i++) along[i] = along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (let i = index - 1; i >= 0; i--) along[i] = along[i + 1] + Math.hypot(pts[i][0] - pts[i + 1][0], pts[i][1] - pts[i + 1][1]);
  return {
    ...s,
    points: pts.map(([x, y, p], i) => {
      const t = radius > 0 ? Math.max(0, 1 - along[i] / radius) : i === index ? 1 : 0;
      const w = t * t * (3 - 2 * t);
      return [x + dx * w, y + dy * w, p];
    }),
  };
}

/** Change the style of strokes in place of the originals (new objects: their outline is recomputed). */
export function restyleStrokes(strokes: Stroke[], patch: Partial<StrokeStyle>): Stroke[] {
  return strokes.map((s) => ({ ...s, ...patch }));
}

/** Solid ink stroke on a canvas. Textured strokes are drawn by design/brushTextures.ts. */
export function drawSolidStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  const d = strokePath(s);
  if (!d) return;
  ctx.save();
  ctx.globalAlpha *= s.opacity;
  ctx.fillStyle = s.color;
  ctx.fill(new Path2D(d));
  ctx.restore();
}

export function solidStrokeSvg(s: Stroke, xmlEscape: (v: string) => string): string {
  const d = strokePath(s);
  if (!d) return '';
  return `<path d="${d}" fill="${xmlEscape(s.color)}"${s.opacity < 1 ? ` fill-opacity="${r(s.opacity)}"` : ''}/>`;
}
