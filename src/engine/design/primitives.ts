import type { ShapeSpec } from '../types';

/*
 * Parametric primitives: polygon, star, sector, arc and chord. Each is kept as its parameters (`prim`) and as the
 * path it draws (`d`, in a unit frame: centre 0,0, radius 1, angles in degrees from the top). The path is then placed
 * in the shape's box like any path shape (box0 → x/y/w/h), so it renders, exports and moves as one. Changing a
 * parameter rebuilds `d` and keeps the box. «Convert to path» keeps `d` and drops `prim`.
 */

export type PrimKind = 'polygon' | 'star' | 'sector' | 'arc' | 'chord';

export interface PrimSpec {
  kind: PrimKind;
  /** polygon and star: number of corners (3–24). */
  sides?: number;
  /** star: inner radius as a share of the outer one (0.1–1). */
  inner?: number;
  /** polygon and star: corner rounding (0 = sharp, 1 = as round as the corner allows). */
  round?: number;
  /** sector, arc, chord: start and end angle in degrees, clockwise from the top. Equal values = full circle. */
  a0?: number;
  a1?: number;
}

const n = (v: number) => Math.round(v * 1000) / 1000;
const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
const PRIM_KINDS: PrimKind[] = ['polygon', 'star', 'sector', 'arc', 'chord'];

/** Parameters clamped to what each kind can draw; missing ones take the defaults of the tool. */
export function normalizePrim(p: Partial<PrimSpec> & { kind: PrimKind }): PrimSpec {
  const kind = PRIM_KINDS.includes(p.kind) ? p.kind : 'polygon';
  const out: PrimSpec = { kind };
  if (kind === 'polygon' || kind === 'star') {
    out.sides = Math.max(3, Math.min(24, Math.round(p.sides ?? 5)));
    out.round = clamp(p.round ?? 0, 0, 1);
  }
  if (kind === 'star') out.inner = clamp(p.inner ?? 0.5, 0.1, 1);
  if (kind === 'sector' || kind === 'arc' || kind === 'chord') {
    out.a0 = norm360(p.a0 ?? 0);
    out.a1 = norm360(p.a1 ?? 270);
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** The vertices of a polygon (sides = corners) or star (2·sides vertices, alternating outer and inner). */
export function starVertices(p: PrimSpec): Array<[number, number]> {
  const sides = p.sides ?? 5;
  const count = p.kind === 'star' ? sides * 2 : sides;
  const inner = p.kind === 'star' ? p.inner ?? 0.5 : 1;
  return Array.from({ length: count }, (_, i) => {
    const r = i % 2 === 1 ? inner : 1;
    const a = rad((i * 360) / count);
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/** Cubic Bézier arcs of the unit circle from a0 to a1, each at most a quarter turn (k = 4/3·tan(θ/4)). */
function arcCurves(a0: number, a1: number): Array<[number, number, number, number, number, number]> {
  let span = norm360(a1 - a0);
  if (span === 0) span = 360;
  const count = Math.max(1, Math.ceil(span / 90));
  const step = (span * Math.PI) / 180 / count;
  const out: Array<[number, number, number, number, number, number]> = [];
  let t = rad(a0);
  for (let i = 0; i < count; i++) {
    const u = t + step;
    const k = (4 / 3) * Math.tan(step / 4);
    const x0 = Math.cos(t), y0 = Math.sin(t), x3 = Math.cos(u), y3 = Math.sin(u);
    out.push([x0 - k * y0, y0 + k * x0, x3 + k * y3, y3 - k * x3, x3, y3]);
    t = u;
  }
  return out;
}

/** The path of a primitive in its unit frame, as SVG path data (absolute M L C Q Z: what parsePath accepts). */
export function primPath(p0: PrimSpec): string {
  const p = normalizePrim(p0);
  if (p.kind === 'polygon' || p.kind === 'star') {
    const v = starVertices(p), t = (p.round ?? 0) * 0.5, m = v.length;
    if (!t) return `M ${v.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L ')} Z`;
    // Each corner is cut back by t of its neighbouring edges and joined by a quadratic through the corner.
    const at = (i: number, j: number): [number, number] => [v[i][0] + (v[j][0] - v[i][0]) * t, v[i][1] + (v[j][1] - v[i][1]) * t];
    const parts: string[] = [];
    const s0 = at(0, 1);
    parts.push(`M ${n(s0[0])} ${n(s0[1])}`);
    for (let k = 1; k <= m; k++) {
      const i = k % m;
      const inP = at(i, (i - 1 + m) % m), outP = at(i, (i + 1) % m);
      parts.push(`L ${n(inP[0])} ${n(inP[1])}`, `Q ${n(v[i][0])} ${n(v[i][1])} ${n(outP[0])} ${n(outP[1])}`);
    }
    return `${parts.join(' ')} Z`;
  }
  const curves = arcCurves(p.a0 ?? 0, p.a1 ?? 270);
  const start = [Math.cos(rad(p.a0 ?? 0)), Math.sin(rad(p.a0 ?? 0))];
  const cs = curves.map((c) => `C ${c.slice(0, 6).map(n).join(' ')}`);
  if (p.kind === 'sector') return `M 0 0 L ${n(start[0])} ${n(start[1])} ${cs.join(' ')} Z`;
  if (p.kind === 'chord') return `M ${n(start[0])} ${n(start[1])} ${cs.join(' ')} Z`;
  return `M ${n(start[0])} ${n(start[1])} ${cs.join(' ')}`;
}

/** The box the curves actually cover (sampled), not the box of their control points: a full arc fills its box. */
export function drawnBox(d: string): { x: number; y: number; w: number; h: number } | null {
  const t = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  const num = () => Number(t[i++]);
  while (i < t.length) {
    if (/[A-Za-z]/.test(t[i])) cmd = t[i++];
    if (cmd === 'Z') { cx = sx; cy = sy; add(cx, cy); continue; }
    if (cmd === 'M' || cmd === 'L') { cx = num(); cy = num(); if (cmd === 'M') { sx = cx; sy = cy; } add(cx, cy); cmd = cmd === 'M' ? 'L' : 'L'; continue; }
    if (cmd === 'Q') {
      const qx = num(), qy = num(), ex = num(), ey = num();
      for (let k = 0; k <= 32; k++) { const u = k / 32, a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u; add(a * cx + b * qx + c * ex, a * cy + b * qy + c * ey); }
      cx = ex; cy = ey; continue;
    }
    if (cmd === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), ex = num(), ey = num();
      for (let k = 0; k <= 32; k++) {
        const u = k / 32, v = 1 - u;
        add(v * v * v * cx + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * ex, v * v * v * cy + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * ey);
      }
      cx = ex; cy = ey; continue;
    }
    return null;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: Math.max(1e-6, maxX - minX), h: Math.max(1e-6, maxY - minY) };
}

/** The unit frame's box: the circle of radius 1 always fills [-1,1], so an angle or a radius change never refits the box. */
export const UNIT_BOX = { x: -1, y: -1, w: 2, h: 2 };

/** A primitive fitted in the box x0,y0 → x1,y1 (drag corners in any order): the shape fields for it. */
export function primShape(x0: number, y0: number, x1: number, y1: number, prim: PrimSpec): Pick<ShapeSpec, 'type' | 'd' | 'box0' | 'x' | 'y' | 'w' | 'h' | 'prim'> {
  const x = Math.min(x0, x1), y = Math.min(y0, y1);
  return { type: 'path', d: primPath(prim), box0: UNIT_BOX, x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), prim: normalizePrim(prim) };
}

/** New parameters for a shape with `prim`: the path is rebuilt in its unit frame and keeps the placed box. */
export function withPrim(s: ShapeSpec, change: Partial<PrimSpec>): Partial<ShapeSpec> | null {
  if (!s.prim) return null;
  const prim = normalizePrim({ ...s.prim, ...change });
  return { prim, d: primPath(prim), box0: UNIT_BOX };
}

/** «Convert to path»: the same outline as plain path data; parameters are gone. */
export function primToPath(): Partial<ShapeSpec> {
  return { prim: undefined };
}

/** Tools that draw a parametric primitive from a box (Stage), and the spec they draw with. */
export const PRIM_TOOLS: ReadonlySet<string> = new Set(['polygon', 'star', 'sector', 'arc', 'chord']);
export const primFromUi = (kind: string, ui: { sides?: number; primParams?: { inner?: number; round?: number; a0?: number; a1?: number } }): PrimSpec =>
  normalizePrim({ kind: kind as PrimKind, sides: ui.sides, ...ui.primParams });

/** A primitive's path placed in its box, in page coordinates (the drag preview). */
export function placedPath(f: { d?: string; box0?: { x: number; y: number; w: number; h: number }; x: number; y: number; w: number; h: number }): Path2D {
  const b = f.box0 ?? f, sx = b.w ? f.w / b.w : 1, sy = b.h ? f.h / b.h : 1;
  const p = new Path2D();
  p.addPath(new Path2D(f.d ?? ''), new DOMMatrix([sx, 0, 0, sy, f.x - b.x * sx, f.y - b.y * sy]));
  return p;
}
