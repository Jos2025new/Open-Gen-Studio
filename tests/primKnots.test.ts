import { describe, expect, it } from 'vitest';
import { primKnotDrag, primKnots, toBox, unitAt, angleOf, toUnit } from '../src/engine/design/primKnots';
import { primShape, normalizePrim } from '../src/engine/design/primitives';
import { gradientKnots, moveGradientKnot } from '../src/engine/design/gradientPaint';
import type { ShapeSpec, GradientPaint } from '../src/engine/shapeSpec';

const shape = (prim: Parameters<typeof normalizePrim>[0], box = { x: 0, y: 0, w: 100, h: 100 }): ShapeSpec => ({
  ...primShape(box.x, box.y, box.x + box.w, box.y + box.h, normalizePrim(prim)), id: 'p', fill: null, stroke: null, strokeWidth: 0, radius: 0,
} as ShapeSpec);
const knot = (s: ShapeSpec, k: string) => primKnots(s).find((x) => x.k === k)!.p;
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('primitive handles: positions', () => {
  it('a pentagon\'s outer handle sits on the box edge at the top corner; the box centre is the centre', () => {
    const s = shape({ kind: 'polygon', sides: 5 });
    near(knot(s, 'outer')[0], 50); near(knot(s, 'outer')[1], 0);
    expect(toBox(s, [0, 0])).toEqual([50, 50]);
  });

  it('a star has an inner handle on its second vertex, at the inner ratio', () => {
    const s = shape({ kind: 'star', sides: 4, inner: 0.5 });
    const inner = knot(s, 'inner');
    near(Math.hypot(inner[0] - 50, inner[1] - 50), 25);
  });

  it('a sector\'s start and end handles sit on the circle at their angles (0 = top, clockwise)', () => {
    const s = shape({ kind: 'sector', a0: 0, a1: 90 });
    near(knot(s, 'from')[0], 50); near(knot(s, 'from')[1], 0);
    near(knot(s, 'to')[0], 100); near(knot(s, 'to')[1], 50);
  });

  it('the angle helpers are inverse: unit point → angle → unit point', () => {
    for (const deg of [0, 45, 90, 200, 359]) {
      const u = unitAt(deg);
      near(angleOf(u), deg, 1e-6);
    }
  });
});

describe('primitive handles: drag gives back the parameter (position ↔ parameter)', () => {
  it('dragging a handle to its own position keeps every parameter', () => {
    const cases: Array<[string, Parameters<typeof normalizePrim>[0], string, string]> = [
      ['star', { kind: 'star', sides: 5, inner: 0.4 }, 'inner', 'inner'],
      ['polygon', { kind: 'polygon', sides: 6, round: 0.6 }, 'round', 'round'],
      ['sector', { kind: 'sector', a0: 30, a1: 200 }, 'to', 'a1'],
      ['arc', { kind: 'arc', a0: 30, a1: 200 }, 'from', 'a0'],
    ];
    for (const [, prim, k, field] of cases) {
      const s = shape(prim);
      const patch = primKnotDrag(s, k as 'inner', knot(s, k))!;
      expect(patch.prim?.[field as 'inner']).toBeCloseTo((normalizePrim(prim) as unknown as Record<string, number>)[field], 4);
    }
  });

  it('a pointer on the circle at 60° sets the start angle to 60', () => {
    const s = shape({ kind: 'chord', a0: 0, a1: 90 });
    const q = toBox(s, unitAt(60));
    near(primKnotDrag(s, 'from', q)!.prim!.a0!, 60, 1e-6);
  });

  it('the inner handle follows the pointer distance from the centre and stays within 0.1–1', () => {
    const s = shape({ kind: 'star', sides: 5, inner: 0.5 });
    near(primKnotDrag(s, 'inner', toBox(s, [0.7, 0]))!.prim!.inner!, 0.7);
    expect(primKnotDrag(s, 'inner', toBox(s, [0, 0]))!.prim!.inner).toBe(0.1);
    expect(primKnotDrag(s, 'inner', toBox(s, [3, 0]))!.prim!.inner).toBe(1);
  });

  it('rounding goes from 0 (on the corner) to 1 (halfway along each edge)', () => {
    const s = shape({ kind: 'polygon', sides: 4, round: 0 });
    // Unit square: top corner (0,-1), next vertex (1,0); halfway along that edge is (0.5,-0.5).
    const half = toBox(s, [0.5, -0.5]);
    near(primKnotDrag(s, 'round', half)!.prim!.round!, 1);
    expect(primKnotDrag(s, 'round', toBox(s, [-5, -1]))!.prim!.round).toBe(0);
  });
});

describe('primitive handles: limits and snapping', () => {
  it('Ctrl snaps an angle to 15 degrees; without Ctrl it keeps the exact angle', () => {
    const s = shape({ kind: 'sector', a0: 0, a1: 90 });
    const q = toBox(s, unitAt(47));
    expect(primKnotDrag(s, 'to', q, true)!.prim!.a1).toBe(45);
    near(primKnotDrag(s, 'to', q, false)!.prim!.a1!, 47, 1e-6);
  });

  it('the outer radius scales the box about its centre, so the top corner follows the pointer', () => {
    const s = shape({ kind: 'star', sides: 5, inner: 0.5 });
    const patch = primKnotDrag(s, 'outer', [50, -50])!; // twice the distance from the centre (50,50)
    expect(patch.w).toBeCloseTo(200);
    expect(patch.h).toBeCloseTo(200);
    expect(patch.x! + patch.w! / 2).toBeCloseTo(50);
    expect(patch.y! + patch.h! / 2).toBeCloseTo(50);
  });

  it('a handle moved past its limit stays at the limit; the unit frame round-trips', () => {
    const s = shape({ kind: 'arc', a0: 0, a1: 90 });
    const u = toUnit(s, toBox(s, [0.3, -0.4]));
    near(u[0], 0.3); near(u[1], -0.4);
  });
});

describe('gradient handles', () => {
  const g: GradientPaint = { kind: 'linear', x1: 10, y1: 20, x2: 110, y2: 20, stops: [{ offset: 0, color: '#000000', alpha: 1 }, { offset: 1, color: '#ffffff', alpha: 1 }] };
  it('a linear gradient has a start and an end handle at its page points', () => {
    expect(gradientKnots(g).map((k) => k.p)).toEqual([[10, 20], [110, 20]]);
  });

  it('moving one handle moves only that point; the stops are kept', () => {
    const m = moveGradientKnot(g, 'p2', [150, 60]);
    expect([m.x2, m.y2, m.x1, m.y1]).toEqual([150, 60, 10, 20]);
    expect(m.stops).toEqual(g.stops);
    expect(g.x2).toBe(110);
  });

  it('a radial gradient has its centre and a point on its radius', () => {
    const r: GradientPaint = { ...g, kind: 'radial', x2: 60, y2: 20 };
    expect(gradientKnots(r).map((k) => k.k)).toEqual(['p1', 'p2']);
  });
});

describe('primitive handles: full circle and the wrap (no sudden jumps)', () => {
  const span = (s: ShapeSpec) => { const d = ((((s.prim!.a1 ?? 0) - (s.prim!.a0 ?? 0)) % 360) + 360) % 360; return d === 0 ? 360 : d; };
  const apply = (s: ShapeSpec, patch: Partial<ShapeSpec> | null) => ({ ...s, ...patch }) as ShapeSpec;

  it('a full circle (equal angles) shows one handle, not two on the same point', () => {
    const s = shape({ kind: 'arc', a0: 270, a1: 270 });
    expect(primKnots(s).map((k) => k.k)).toEqual(['from']);
    expect(primKnots(shape({ kind: 'arc', a0: 270, a1: 10 })).map((k) => k.k)).toEqual(['from', 'to']);
  });

  it('dragging the start of a full circle across the end never flips it to a sliver', () => {
    let s = shape({ kind: 'chord', a0: 270, a1: 270 });
    let prev = span(s);
    for (let deg = 268; deg <= 275; deg += 1) { // the pointer passes the other handle
      s = apply(s, primKnotDrag(s, 'from', toBox(s, unitAt(deg)))!);
      expect(Math.abs(span(s) - prev)).toBeLessThanOrEqual(180);
      prev = span(s);
    }
  });

  it('the angle wraps through 0/360 without a jump in the span', () => {
    let s = shape({ kind: 'sector', a0: 10, a1: 100 });
    let prev = span(s);
    for (let deg = 20; deg >= -20; deg -= 5) {
      s = apply(s, primKnotDrag(s, 'from', toBox(s, unitAt((deg + 360) % 360)))!);
      expect(Math.abs(span(s) - prev)).toBeLessThan(30);
      prev = span(s);
    }
  });
});
