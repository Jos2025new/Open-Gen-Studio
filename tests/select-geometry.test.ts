import { describe, expect, it } from 'vitest';
import { boxCorners, boxOutline, ellipsePoints, snapAngle } from '../src/engine/design/selectGeometry';

const o = { x: 10, y: 10 };

describe('selection box geometry', () => {
  it('Shift squares the box with the longer side, in all four quadrants', () => {
    expect(boxCorners(o, { x: 40, y: 20 }, { square: true })).toEqual({ x0: 10, y0: 10, x1: 40, y1: 40 });
    expect(boxCorners(o, { x: -20, y: 15 }, { square: true })).toEqual({ x0: 10, y0: 10, x1: -20, y1: 40 });
    expect(boxCorners(o, { x: 15, y: -30 }, { square: true })).toEqual({ x0: 10, y0: 10, x1: 50, y1: -30 });
    expect(boxCorners(o, { x: -5, y: -8 }, { square: true })).toEqual({ x0: 10, y0: 10, x1: -8, y1: -8 });
  });
  it('Alt grows from the first point; with Shift it is a centred square', () => {
    expect(boxCorners(o, { x: 20, y: 15 }, { centre: true })).toEqual({ x0: 0, y0: 5, x1: 20, y1: 15 });
    expect(boxCorners(o, { x: 20, y: 15 }, { centre: true, square: true })).toEqual({ x0: 0, y0: 0, x1: 20, y1: 20 });
  });
  it('the readout is the whole box (with Alt, both halves) and zero size stays zero', () => {
    const r = boxOutline('rect', o, { x: 20, y: 15 }, { centre: true });
    expect([r.w, r.h]).toEqual([20, 10]);
    expect(r.points).toHaveLength(4);
    const z = boxOutline('rect', o, o, { square: true });
    expect([z.w, z.h]).toEqual([0, 0]);
  });
});

describe('ellipse as a polygon', () => {
  const bbox = (p: Array<[number, number]>) => ({ x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) });
  const areaOf = (p: Array<[number, number]>) => Math.abs(p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;
  it('vertex count is clamped to 24..720 and grows with the radius', () => {
    expect(ellipsePoints(0, 0, 2, 2).length).toBe(24);
    expect(ellipsePoints(0, 0, 200, 100).length).toBeGreaterThan(24);
    expect(ellipsePoints(0, 0, 1e6, 1e6).length).toBe(720);
  });
  it('its box is exact and its area is about pi*a*b', () => {
    const p = ellipsePoints(10, 20, 110, 80);
    const b = bbox(p);
    expect([b.x0, b.x1, b.y0, b.y1].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 110, 20, 80]);
    expect(areaOf(p) / (Math.PI * 50 * 30)).toBeGreaterThan(0.99);
  });
  it('Shift makes a circle, Alt centres it on the press', () => {
    const r = boxOutline('ellipse', o, { x: 30, y: 20 }, { square: true, centre: true });
    expect([r.w, r.h]).toEqual([40, 40]);
    const b = bbox(r.points);
    expect([b.x0, b.x1].map(Math.round)).toEqual([-10, 30]);
  });
});

describe('45 degree snap', () => {
  it('pulls onto the nearest step and keeps the length', () => {
    const p = snapAngle(o, { x: 40, y: 12 });
    expect(p.y).toBeCloseTo(10, 6);
    const d = snapAngle(o, { x: 30, y: 33 });
    expect(d.x - 10).toBeCloseTo(d.y - 10, 6);
    expect(Math.hypot(d.x - 10, d.y - 10)).toBeCloseTo(Math.hypot(20, 23), 6);
  });
});
