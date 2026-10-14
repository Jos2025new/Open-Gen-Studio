import { describe, expect, it } from 'vitest';
import { drawnBox, normalizePrim, primPath, primShape, primToPath, starVertices, withPrim } from '../src/engine/design/primitives';
import { parsePath, pathTransform } from '../src/engine/design/path';
import type { ShapeSpec, VectorShape } from '../src/engine/types';

const close = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

describe('polygon and star vertices', () => {
  it('a pentagon has five corners on the unit circle, the first at the top', () => {
    const v = starVertices(normalizePrim({ kind: 'polygon', sides: 5 }));
    expect(v).toHaveLength(5);
    v.forEach(([x, y]) => expect(close(Math.hypot(x, y), 1)).toBe(true));
    expect(close(v[0][0], 0)).toBe(true);
    expect(close(v[0][1], -1)).toBe(true);
  });

  it('a star alternates outer and inner radii, the inner one set by the ratio', () => {
    const v = starVertices(normalizePrim({ kind: 'star', sides: 6, inner: 0.4 }));
    expect(v).toHaveLength(12);
    v.forEach(([x, y], i) => expect(close(Math.hypot(x, y), i % 2 ? 0.4 : 1)).toBe(true));
  });

  it('sides are clamped to 3–24 and the inner ratio to 0.1–1', () => {
    expect(normalizePrim({ kind: 'polygon', sides: 1 }).sides).toBe(3);
    expect(normalizePrim({ kind: 'polygon', sides: 99 }).sides).toBe(24);
    expect(normalizePrim({ kind: 'star', inner: 0 }).inner).toBe(0.1);
  });
});

describe('sector, arc and chord', () => {
  it('a quarter sector from the top to the right: centre, two radii and a quarter arc', () => {
    const d = primPath({ kind: 'sector', a0: 0, a1: 90 });
    expect(d.startsWith('M 0 0 L 0 -1 ')).toBe(true);
    const b = parsePath(d);
    expect('error' in b).toBe(false);
    if (!('error' in b)) {
      expect(close(b.box.x, 0)).toBe(true);
      expect(close(b.box.y, -1)).toBe(true);
      expect(close(b.box.x + b.box.w, 1)).toBe(true);
      expect(close(b.box.y + b.box.h, 0)).toBe(true);
    }
  });

  it('an arc is open: no closing command and it ends on the end angle', () => {
    const d = primPath({ kind: 'arc', a0: 0, a1: 180 });
    expect(d.endsWith('Z')).toBe(false);
    const ends = d.match(/C [^C]+$/)![0].trim().split(/\s+/).slice(-2).map(Number);
    expect(close(ends[0], 0)).toBe(true);
    expect(close(ends[1], 1)).toBe(true);
  });

  it('a chord is a closed arc with its ends joined by a straight line (no centre)', () => {
    const d = primPath({ kind: 'chord', a0: 0, a1: 180 });
    expect(d.startsWith('M 0 -1 ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.includes('M 0 0')).toBe(false);
  });

  it('equal start and end angles draw the full circle; long spans split into quarter turns', () => {
    const full = drawnBox(primPath({ kind: 'arc', a0: 30, a1: 30 }))!;
    expect(close(full.w, 2, 0.02)).toBe(true);
    expect(close(full.h, 2, 0.02)).toBe(true);
    expect(primPath({ kind: 'arc', a0: 0, a1: 270 }).match(/C/g)).toHaveLength(3);
  });
});

describe('placing and editing', () => {
  it('a primitive fills the dragged box, in any drag direction', () => {
    const s = primShape(100, 200, 40, 120, { kind: 'polygon', sides: 4 });
    expect(s.type).toBe('path');
    expect(s.x).toBe(40);
    expect(s.y).toBe(120);
    expect(s.w).toBe(60);
    expect(s.h).toBe(80);
    expect(s.prim).toEqual({ kind: 'polygon', sides: 4, round: 0 });
    // The unit frame maps onto the box exactly.
    const t = pathTransform({ ...s, type: 'path' } as ShapeSpec);
    expect(close(t.sx * s.box0!.w, s.w)).toBe(true);
  });

  it('changing a parameter rebuilds the path and keeps the placed box', () => {
    const s = { ...primShape(0, 0, 100, 100, { kind: 'star', sides: 5, inner: 0.5 }), id: 'a', fill: null, stroke: null, strokeWidth: 0, radius: 0 } as ShapeSpec;
    const patch = withPrim(s, { sides: 7 })!;
    expect(patch.prim?.sides).toBe(7);
    expect(patch.d).not.toBe(s.d);
    expect(withPrim({ ...s, prim: undefined }, { sides: 7 })).toBeNull();
  });

  it('a corner rounding cuts each corner and joins it with a quadratic', () => {
    const sharp = primPath({ kind: 'polygon', sides: 4, round: 0 });
    const round = primPath({ kind: 'polygon', sides: 4, round: 1 });
    expect(sharp.includes('Q')).toBe(false);
    expect(round.match(/Q/g)).toHaveLength(4);
    expect('error' in parsePath(round)).toBe(false);
  });

  it('every generated path is accepted by the path parser (absolute M L C Q Z only)', () => {
    const shapes = [
      { kind: 'polygon', sides: 6, round: 0.5 }, { kind: 'star', sides: 5, inner: 0.3, round: 0.2 },
      { kind: 'sector', a0: 300, a1: 60 }, { kind: 'arc', a0: 0, a1: 359 }, { kind: 'chord', a0: 10, a1: 200 },
    ] as const;
    for (const p of shapes) expect('error' in parsePath(primPath({ ...p }))).toBe(false);
  });

  it('«Convert to path» keeps the outline and drops the parameters', () => {
    const s = primShape(0, 0, 10, 10, { kind: 'arc', a0: 0, a1: 90 });
    const p = primToPath();
    expect(p.prim).toBeUndefined();
    expect({ ...s, ...p }.d).toBe(s.d);
  });
});

describe('export of a primitive', () => {
  it('is exported as a plain path with its outline, parameters left out', async () => {
    const { shapeSvg } = await import('../src/engine/design/export');
    const s = { ...primShape(0, 0, 100, 50, { kind: 'star', sides: 5, inner: 0.5 }), id: 'p1', fill: '#ff0000', stroke: null, strokeWidth: 0, radius: 0 } as VectorShape;
    const svg = shapeSvg(s);
    expect(svg.startsWith('<path d="M ')).toBe(true);
    expect(svg).not.toContain('prim');
  });
});
