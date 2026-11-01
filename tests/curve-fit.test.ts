import { describe, expect, it } from 'vitest';
import { fitPolyline, fitSubpaths } from '../src/engine/design/curveFit';
import type { Pt, Seg } from '../src/engine/design/pathNodes';

const TOL = 0.25;

function circle(n: number, r = 100): Pt[] {
  return Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as Pt);
}
function densify(corners: Pt[], step: number, closed = true): Pt[] {
  const out: Pt[] = [];
  const last = closed ? corners.length : corners.length - 1;
  for (let i = 0; i < last; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  if (!closed) out.push(corners[corners.length - 1]);
  return out;
}
/** Flatten the result into a dense polyline (closing back to the start when a Z is present). */
function sample(segs: Seg[], per = 40): Pt[] {
  const out: Pt[] = [];
  let cur: Pt = [0, 0], start: Pt = [0, 0];
  for (const s of segs) {
    if (s.c === 'M') { cur = start = s.p[0]; out.push(cur); }
    else if (s.c === 'L') { cur = s.p[0]; out.push(cur); }
    else if (s.c === 'C') {
      const [a, b, c] = s.p;
      for (let i = 1; i <= per; i++) {
        const t = i / per, m = 1 - t;
        out.push([m * m * m * cur[0] + 3 * m * m * t * a[0] + 3 * m * t * t * b[0] + t * t * t * c[0], m * m * m * cur[1] + 3 * m * m * t * a[1] + 3 * m * t * t * b[1] + t * t * t * c[1]]);
      }
      cur = c;
    } else if (s.c === 'Z') out.push(start);
  }
  return out;
}
function distSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function distPoly(p: Pt, poly: Pt[]): number {
  let m = Infinity;
  for (let i = 0; i + 1 < poly.length; i++) m = Math.min(m, distSeg(p, poly[i], poly[i + 1]));
  return m;
}
/** Two-way sampled deviation between an input polyline and the fitted result. */
function deviation(input: Pt[], closed: boolean, segs: Seg[]): number {
  const a = closed ? [...input, input[0]] : input;
  const b = sample(segs);
  let m = 0;
  for (const p of densify(a, 0.5, false)) m = Math.max(m, distPoly(p, b));
  for (const p of b) m = Math.max(m, distPoly(p, a));
  return m;
}
const count = (segs: Seg[], c: Seg['c']) => segs.filter((s) => s.c === c).length;
const nodesOf = (segs: Seg[]) => segs.filter((s) => s.c !== 'Z').map((s) => s.p[s.p.length - 1]);
const hasNode = (segs: Seg[], c: number[]) => nodesOf(segs).some((n) => Math.hypot(n[0] - c[0], n[1] - c[1]) < 1e-6);

describe('fitPolyline', () => {
  it('fits a 720-point circle with a few curves inside tolerance', () => {
    const pts = circle(720);
    const segs = fitPolyline(pts, true, { tolerance: TOL });
    expect(count(segs, 'C')).toBeLessThanOrEqual(8);
    expect(count(segs, 'L')).toBe(0);
    expect(segs[segs.length - 1].c).toBe('Z');
    expect(deviation(pts, true, segs)).toBeLessThanOrEqual(TOL);
  });

  it('keeps the 4 corners of a densified square as 4 lines', () => {
    const pts = densify([[0, 0], [100, 0], [100, 100], [0, 100]], 2);
    const segs = fitPolyline(pts, true, { tolerance: TOL });
    expect(count(segs, 'L')).toBe(4);
    expect(count(segs, 'C')).toBe(0);
    for (const c of [[0, 0], [100, 0], [100, 100], [0, 100]]) expect(hasNode(segs, c)).toBe(true);
    expect(deviation(pts, true, segs)).toBeLessThanOrEqual(TOL);
  });

  it('keeps 3 sharp corners on a rectangle with one rounded corner', () => {
    const r = 20;
    const pts: Pt[] = [...densify([[0, 0], [100, 0], [100, 60]], 2, false)];
    for (let k = 0; k <= 90; k += 3) { const t = (k * Math.PI) / 180; pts.push([80 + r * Math.cos(t), 60 + r * Math.sin(t)]); }
    pts.push(...densify([[80, 80], [0, 80], [0, 0]], 2, false).slice(0, -1));
    const segs = fitPolyline(pts, true, { tolerance: TOL });
    for (const c of [[0, 0], [100, 0], [0, 80]]) expect(hasNode(segs, c)).toBe(true);
    expect(count(segs, 'C')).toBeGreaterThanOrEqual(1);
    expect(count(segs, 'C')).toBeLessThanOrEqual(3);
    expect(deviation(pts, true, segs)).toBeLessThanOrEqual(TOL);
  });

  it('fits an open S-curve without Z', () => {
    const pts: Pt[] = Array.from({ length: 300 }, (_, i) => [i, 40 * Math.sin((i / 299) * 2 * Math.PI)] as Pt);
    const segs = fitPolyline(pts, false, { tolerance: TOL });
    expect(segs[0].c).toBe('M');
    expect(count(segs, 'Z')).toBe(0);
    expect(count(segs, 'C')).toBeGreaterThanOrEqual(1);
    expect(segs.length).toBeLessThan(10);
    expect(deviation(pts, false, segs)).toBeLessThanOrEqual(TOL);
  });

  it('closes loops with Z on the start point and leaves open ones open', () => {
    const pts = circle(100);
    const closed = fitPolyline(pts, true, { tolerance: TOL });
    const open = fitPolyline(pts, false, { tolerance: TOL });
    expect(closed[closed.length - 1].c).toBe('Z');
    expect(open.some((s) => s.c === 'Z')).toBe(false);
    const last = closed[closed.length - 2].p.slice(-1)[0];
    expect(Math.hypot(last[0] - closed[0].p[0][0], last[1] - closed[0].p[0][1])).toBeLessThan(1e-6);
  });

  it('returns [] for degenerate input and never throws', () => {
    expect(fitPolyline([], true, { tolerance: TOL })).toEqual([]);
    expect(fitPolyline([[1, 1]], false, { tolerance: TOL })).toEqual([]);
    expect(fitPolyline([[1, 1], [1, 1], [1, 1]], true, { tolerance: TOL })).toEqual([]);
    expect(fitPolyline([[NaN, 0], [Infinity, 1]], false, { tolerance: TOL })).toEqual([]);
    expect(() => fitPolyline(null as unknown as Pt[], true, { tolerance: TOL })).not.toThrow();
    expect(fitPolyline([[0, 0], [10, 0]], false, { tolerance: TOL }).map((s) => s.c)).toEqual(['M', 'L']);
  });

  it.each([0.1, 0.25, 0.5, 1])('respects tolerance %s on an ellipse and a wobbly blob', (tol) => {
    const ell: Pt[] = Array.from({ length: 900 }, (_, i) => [150 * Math.cos((i / 900) * 2 * Math.PI), 60 * Math.sin((i / 900) * 2 * Math.PI)] as Pt);
    const blob: Pt[] = Array.from({ length: 900 }, (_, i) => {
      const t = (i / 900) * 2 * Math.PI, r = 80 + 15 * Math.sin(3 * t) + 6 * Math.cos(5 * t);
      return [r * Math.cos(t), r * Math.sin(t)] as Pt;
    });
    for (const pts of [ell, blob]) {
      const segs = fitPolyline(pts, true, { tolerance: tol });
      expect(deviation(pts, true, segs)).toBeLessThanOrEqual(tol);
      expect(segs.length).toBeLessThan(40);
    }
  });

  it('fits a 2000-point circle quickly', () => {
    const pts = circle(2000);
    const t0 = performance.now();
    const segs = fitPolyline(pts, true, { tolerance: TOL });
    const ms = performance.now() - t0;
    console.log(`curveFit 2000-pt circle: ${ms.toFixed(1)} ms, ${count(segs, 'C')} C`);
    expect(count(segs, 'C')).toBeLessThanOrEqual(8);
    expect(ms).toBeLessThan(200);
  });
});

describe('fitSubpaths', () => {
  it('concatenates outer contour and hole', () => {
    const segs = fitSubpaths([{ points: circle(400, 100), closed: true }, { points: circle(400, 40), closed: true }], { tolerance: TOL });
    expect(count(segs, 'M')).toBe(2);
    expect(count(segs, 'Z')).toBe(2);
    expect(fitSubpaths([], { tolerance: TOL })).toEqual([]);
  });
});
