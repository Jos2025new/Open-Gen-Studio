import { describe, expect, it } from 'vitest';
import { getStroke, getStrokePoints } from 'perfect-freehand';
import { nibFactor, nibOutline, nibStrokeOutline } from '../src/engine/design/nibOutline';
import { DEFAULT_STROKE_STYLE, newStroke, solidStrokeSvg, strokeOptions, strokeOutline } from '../src/engine/design/strokes';

/* Lineart calligraphic nib (nibOutline.ts, from Inkscape's calligraphic-tool.cpp). Old strokes must render as before. */
const wave: Array<[number, number, number]> = Array.from({ length: 40 }, (_, i) => [i * 4, 30 + Math.sin(i / 5) * 12, 0.3 + 0.5 * Math.abs(Math.sin(i / 7))]);
const style = { ...DEFAULT_STROKE_STYLE, size: 20 };
const base = () => newStroke(wave, style, false);

describe('nib outline', () => {
  it('with factor 1 the port returns exactly what perfect-freehand returns', () => {
    for (const sim of [false, true]) for (const thinning of [0, 0.6, -0.4]) for (const taper of [0, 12]) {
      const o = { ...strokeOptions({ ...base(), thinning, simulatePressure: sim, taperStart: taper, taperEnd: taper }) };
      const mine = nibOutline(getStrokePoints(wave, o), o, () => 1);
      expect(mine).toEqual(getStroke(wave, o));
    }
    const dot = [[5, 5, 0.5]] as Array<[number, number, number]>;
    const o = strokeOptions(base());
    expect(nibOutline(getStrokePoints(dot, o), o, () => 1)).toEqual(getStroke(dot, o));
  });

  it('strokes without nib fields, or with fixation 0, keep today\'s outline', () => {
    const plain = base();
    const old = getStroke(plain.points, strokeOptions(plain));
    expect(strokeOutline(plain)).toEqual(old);
    expect(strokeOutline({ ...plain, nibAngle: 40, nibFixation: 0, nibMin: 0.3 })).toEqual(old);
    expect(strokeOutline({ ...plain, nibAngle: 40, nibFixation: 0.5 })).not.toEqual(old);
  });

  it('fixation 100 %, 0° nib: horizontal travel is thin (min width), vertical is full', () => {
    expect(nibFactor(0, 1, 0.1, 1, 0)).toBeCloseTo(0.1);
    expect(nibFactor(0, 1, 0.1, 0, 1)).toBeCloseTo(1);
    expect(nibFactor(0, 1, 0.1, 0, -1)).toBeCloseTo(1);
    expect(nibFactor(0, 1, 0, 1, 0)).toBeCloseTo(0);
    expect(nibFactor(0, 1, 0, 1, 1)).toBeCloseTo(Math.SQRT1_2);
    // fixation 0: constant width whatever the direction or nib angle
    for (const [x, y] of [[1, 0], [0, 1], [1, 2]]) expect(nibFactor(37, 0, 0.1, x, y)).toBeCloseTo(1);
  });

  it('measured outline widths: a horizontal line is thinner than a vertical one', () => {
    const o = { ...strokeOptions({ ...base(), thinning: 0 }) };
    const h = Array.from({ length: 30 }, (_, i) => [i * 3, 50, 0.5] as [number, number, number]);
    const v = h.map(([x, , p]) => [50, x, p] as [number, number, number]);
    const nib = { nibAngle: 0, nibFixation: 1, nibMin: 0.1 };
    const span = (pts: number[][], k: 0 | 1) => { const m = pts.slice(10, -10).map((q) => q[k]); return Math.max(...m) - Math.min(...m); };
    expect(span(nibStrokeOutline(h, o, nib), 1)).toBeLessThan(0.15 * 20 + 1);
    expect(span(nibStrokeOutline(v, o, nib), 0)).toBeGreaterThan(19);
  });

  it('angle wraps by half a turn and the width never falls under the minimum', () => {
    for (const [x, y] of [[1, 0.3], [-1, 2], [0.2, -1]]) {
      expect(nibFactor(30, 0.7, 0.1, x, y)).toBeCloseTo(nibFactor(30 + 180, 0.7, 0.1, x, y));
      expect(nibFactor(30, 0.7, 0.1, x, y)).toBeCloseTo(nibFactor(30 - 180, 0.7, 0.1, x, y));
      expect(nibFactor(30, 0.7, 0.1, x, y)).toBeCloseTo(nibFactor(30 + 360, 0.7, 0.1, x, y));
      expect(nibFactor(30, 0.7, 0.25, x, y)).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('SVG export of a nib stroke is a closed path with finite numbers', () => {
    const svg = solidStrokeSvg({ ...base(), nibAngle: 20, nibFixation: 0.9 }, (x) => x);
    const d = /d="([^"]+)"/.exec(svg)![1];
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});
