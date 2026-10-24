import { describe, expect, it } from 'vitest';
import { shapeSvg } from '../src/engine/design/export';
import { primShape, type PrimSpec } from '../src/engine/design/primitives';
import type { VectorShape } from '../src/engine/types';

/*
 * Round trip of every ellipse type and of polygons and stars: the shape → its SVG export → parsed back (path commands
 * and matrix) → compared with the ellipse or polygon it must be. Prims export as cubic Bézier <path>s (no A commands),
 * so the W3C arc rules (SVG 1.1 §F.6.5 endpoint → centre parameterization) are checked the other way round: for the
 * exported endpoints, radii, large-arc flag and sweep flag derived from the angles, the centre recovered is the ellipse's.
 */
const BOX = { x: 40, y: 30, w: 200, h: 100 };
const cx = BOX.x + BOX.w / 2, cy = BOX.y + BOX.h / 2, rx = BOX.w / 2, ry = BOX.h / 2;
const shape = (p: PrimSpec) => ({ ...primShape(BOX.x, BOX.y, BOX.x + BOX.w, BOX.y + BOX.h, p), id: 's', fill: '#f00', stroke: '#000', strokeWidth: 2, radius: 0 }) as VectorShape;

type Pt = [number, number];
type Seg = { cmd: 'M' | 'L' | 'C' | 'Q' | 'Z'; pts: Pt[] };

/** The path and matrix of an exported prim, parsed back; points are in page coordinates. */
function parseExport(svg: string): Seg[] {
  const d = /<path d="([^"]+)"/.exec(svg)![1];
  const m = /matrix\(([^)]+)\)/.exec(svg)![1].split(' ').map(Number);
  const tp = (x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const segs: Seg[] = [];
  for (const part of d.match(/[MLCQZ][^MLCQZ]*/g) ?? []) {
    const nums = part.slice(1).trim().split(/\s+/).filter(Boolean).map(Number);
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push(tp(nums[i], nums[i + 1]));
    segs.push({ cmd: part[0] as Seg['cmd'], pts });
  }
  return segs;
}
const cubicAt = (p0: Pt, [a, b, c]: Pt[], t: number): Pt => {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * a[i] + 3 * u * t * t * b[i] + t * t * t * c[i]) as Pt;
};
/** Position on the ellipse at an angle in degrees clockwise from the top (the prim convention). */
const onEllipse = (deg: number): Pt => { const a = ((deg - 90) * Math.PI) / 180; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; };
const radial = ([x, y]: Pt) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
const near = (a: Pt, b: Pt, eps = 0.1) => Math.hypot(a[0] - b[0], a[1] - b[1]) < eps;
const span = (a0: number, a1: number) => { const d = (((a1 - a0) % 360) + 360) % 360; return d === 0 ? 360 : d; };

/** SVG 1.1 §F.6.5: centre of the arc from endpoints, radii, flags (no x-axis rotation). */
function centreFromEndpoints(p1: Pt, p2: Pt, rX: number, rY: number, fA: boolean, fS: boolean): Pt {
  const x1p = (p1[0] - p2[0]) / 2, y1p = (p1[1] - p2[1]) / 2;
  const num = rX * rX * rY * rY - rX * rX * y1p * y1p - rY * rY * x1p * x1p;
  const den = rX * rX * y1p * y1p + rY * rY * x1p * x1p;
  const k = (fA === fS ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rX * y1p) / rY, cyp = (-k * rY * x1p) / rX;
  return [cxp + (p1[0] + p2[0]) / 2, cyp + (p1[1] + p2[1]) / 2];
}

const ARC_CASES: Array<[string, number, number]> = [['0→270', 0, 270], ['edge 0→0', 0, 0], ['359.9', 0, 359.9], ['start==end', 120, 120], ['start>end', 300, 60], ['start>end wide', 350, 10], ['0→180', 0, 180], ['90→10', 90, 10]];

describe.each(['sector', 'arc', 'chord'] as const)('%s export round trip', (kind) => {
  it.each(ARC_CASES)('%s: every point is on the ellipse, endpoints sit at the angles, the span is right', (_n, a0, a1) => {
    const svg = shapeSvg(shape({ kind, a0, a1 }));
    expect(svg).not.toContain(' A ');
    const segs = parseExport(svg);
    let i = 0;
    const lead = kind === 'sector' ? 2 : 1; // sector: M centre, L start
    if (kind === 'sector') {
      expect(segs[0].cmd).toBe('M'); expect(near(segs[0].pts[0], [cx, cy])).toBe(true);
      expect(segs[1].cmd).toBe('L');
    } else expect(segs[0].cmd).toBe('M');
    const start = segs[lead - 1].pts[0];
    expect(near(start, onEllipse(a0))).toBe(true);
    // Walk the cubics: sample each, check the ellipse equation, add up the swept angle.
    let prev = start, swept = 0, last = start;
    for (i = lead; i < segs.length && segs[i].cmd === 'C'; i++) {
      for (let t = 0; t <= 1.0001; t += 0.125) expect(Math.abs(radial(cubicAt(prev, segs[i].pts, Math.min(1, t))) - 1)).toBeLessThan(2e-3);
      const end = segs[i].pts[2];
      const ang = (p: Pt) => Math.atan2((p[1] - cy) / ry, (p[0] - cx) / rx);
      let da = ang(end) - ang(prev); if (da < -1e-9) da += 2 * Math.PI;
      swept += da; prev = end; last = end;
    }
    expect(near(last, onEllipse(a1))).toBe(true);
    const want = span(a0, a1);
    expect((swept * 180) / Math.PI).toBeCloseTo(want === 360 ? 360 : want, 1);
    expect(segs.length - (kind === 'arc' ? 0 : 1)).toBeGreaterThan(lead);
    // Closing: a sector and a chord end with Z, an arc stays open.
    expect(segs[segs.length - 1].cmd === 'Z').toBe(kind !== 'arc');
  });
  it.each(ARC_CASES.filter(([, a0, a1]) => span(a0, a1) < 360 && span(a0, a1) !== 180))('%s: W3C flags (large-arc, sweep) recover the centre', (_n, a0, a1) => {
    const large = span(a0, a1) > 180;
    const sweep = true; // angles grow clockwise on a y-down page: SVG sweep-flag = 1 (positive-angle direction)
    const c = centreFromEndpoints(onEllipse(a0), onEllipse(a1), rx, ry, large, sweep);
    expect(near(c, [cx, cy], 1e-6)).toBe(true);
    // The wrong large-arc flag would pick the mirrored centre.
    expect(near(centreFromEndpoints(onEllipse(a0), onEllipse(a1), rx, ry, !large, sweep), [cx, cy], 1e-3)).toBe(false);
  });
});

describe('polygon and star export round trip', () => {
  it.each([3, 24])('polygon with %i corners: vertices on the ellipse, first at the top', (n) => {
    const segs = parseExport(shapeSvg(shape({ kind: 'polygon', sides: n })));
    const pts = segs.filter((s) => s.cmd === 'M' || s.cmd === 'L').map((s) => s.pts[0]);
    expect(pts).toHaveLength(n);
    pts.forEach((p, i) => { expect(near(p, onEllipse((i * 360) / n))).toBe(true); });
    expect(segs[segs.length - 1].cmd).toBe('Z');
  });
  it.each([3, 24])('star with %i corners and spoke ratio 0.4: alternating outer and inner vertices', (n) => {
    const segs = parseExport(shapeSvg(shape({ kind: 'star', sides: n, inner: 0.4 })));
    const pts = segs.filter((s) => s.cmd === 'M' || s.cmd === 'L').map((s) => s.pts[0]);
    expect(pts).toHaveLength(2 * n);
    pts.forEach((p, i) => { expect(Math.sqrt(radial(p))).toBeCloseTo(i % 2 ? 0.4 : 1, 3); });
  });
  it('a rounded corner stays inside the sharp polygon and the path stays closed', () => {
    const segs = parseExport(shapeSvg(shape({ kind: 'polygon', sides: 24, round: 1 })));
    expect(segs.filter((s) => s.cmd === 'Q')).toHaveLength(24);
    expect(segs[segs.length - 1].cmd).toBe('Z');
  });
});
