import { describe, expect, it } from 'vitest';
import { primKnotDrag, primKnots } from '../src/engine/design/primKnots';
import { primShape, type PrimSpec } from '../src/engine/design/primitives';
import { convertCorners, convertEllipse, ellipseTypeOf, ellipseTypeOfTool, isWholeArc, radiiOf, toolForEllipseType, withRadius } from '../src/engine/design/shapeKinds';
import { TOOLBOX, toolboxTools } from '../src/components/designer/toolboxModel';
import { TOOL_NAMES, DESIGN_TOOL_KEYS } from '../src/engine/shortcuts';
import type { ShapeSpec } from '../src/engine/shapeSpec';
import type { VectorShape } from '../src/engine/types';

const look = { id: 's', fill: '#f00', stroke: '#000', strokeWidth: 2, radius: 0 };
const prim = (p: PrimSpec, box: [number, number, number, number] = [0, 0, 200, 100]) => ({ ...primShape(...box, p), ...look }) as VectorShape;
const ellipse = (): VectorShape => ({ ...look, type: 'ellipse', x: 10, y: 20, w: 200, h: 100 }) as VectorShape;

describe('merged shape tools: model', () => {
  it('maps types to the old tool ids and back', () => {
    expect(toolForEllipseType('whole')).toBe('ellipse');
    expect(toolForEllipseType('slice')).toBe('sector');
    expect(ellipseTypeOfTool('chord')).toBe('chord');
    expect(ellipseTypeOfTool('rect')).toBeNull();
  });
  it('the toolbox has one variant per merged tool and every tool and key stays reachable', () => {
    const edit = TOOLBOX.find((f) => f.id === 'edit')!.variants.map((v) => v.id);
    expect(edit).toEqual(['edit', 'hand', 'rect', 'ellipse', 'line', 'polygon']);
    expect([...toolboxTools()].sort()).toEqual(Object.keys(TOOL_NAMES).sort());
    for (const t of Object.values(DESIGN_TOOL_KEYS)) expect(toolboxTools()).toContain(t);
    expect(TOOLBOX.flatMap((f) => f.variants).find((v) => v.id === 'ellipse')!.also).toEqual(['sector', 'arc', 'chord']);
  });
  it('whole detection follows Inkscape: extent near 0 or a full turn', () => {
    expect(isWholeArc(30, 30)).toBe(true);
    expect(isWholeArc(0, 360)).toBe(true);
    expect(isWholeArc(0, 359.9)).toBe(false);
    expect(isWholeArc(90, 10)).toBe(false);
    expect(isWholeArc(10, 10 + 1e-6)).toBe(true);
  });
});

describe('merged shape tools: converting in place', () => {
  it('a whole ellipse becomes a slice, arc or chord with the same centre and radii, default angles', () => {
    const e = ellipse();
    for (const t of ['slice', 'arc', 'chord'] as const) {
      const s = { ...e, ...convertEllipse(e, t) } as VectorShape;
      expect(ellipseTypeOf(s)).toBe(t);
      expect(s.prim).toMatchObject({ a0: 0, a1: 270 });
      expect([s.x, s.y, s.w, s.h]).toEqual([10, 20, 200, 100]);
    }
  });
  it('slice → arc → chord keeps the angles; any → whole drops the parameters and keeps the box', () => {
    let s = prim({ kind: 'sector', a0: 40, a1: 200 });
    s = { ...s, ...convertEllipse(s, 'arc') } as VectorShape;
    expect(s.prim).toMatchObject({ kind: 'arc', a0: 40, a1: 200 });
    s = { ...s, ...convertEllipse(s, 'chord') } as VectorShape;
    expect(s.prim).toMatchObject({ kind: 'chord', a0: 40, a1: 200 });
    const w = { ...s, ...convertEllipse(s, 'whole') } as VectorShape;
    expect(w.type).toBe('ellipse');
    expect(w.prim).toBeUndefined();
    expect([w.x, w.y, w.w, w.h]).toEqual([s.x, s.y, s.w, s.h]);
    expect(convertEllipse(w, 'whole')).toBeNull();
  });
  it('Rx and Ry change about the centre', () => {
    const e = ellipse();
    const s = { ...e, ...withRadius(e, 'rx', 30) } as VectorShape;
    expect(radiiOf(s)).toEqual({ rx: 30, ry: 50 });
    expect(s.x + s.w / 2).toBe(110);
  });
  it('polygon ↔ star keeps corners and rounding', () => {
    const p = prim({ kind: 'polygon', sides: 7, round: 0.3 });
    const star = { ...p, ...convertCorners(p, 'star') } as VectorShape;
    expect(star.prim).toMatchObject({ kind: 'star', sides: 7, round: 0.3, inner: 0.5 });
    expect({ ...star, ...convertCorners(star, 'polygon') }.prim).toMatchObject({ kind: 'polygon', sides: 7, round: 0.3 });
    expect(convertCorners(p, 'polygon')).toBeNull();
  });
  it('corners are limited to 3–24 in the engine', () => {
    expect(prim({ kind: 'polygon', sides: 30 }).prim!.sides).toBe(24);
    expect(prim({ kind: 'star', sides: 1 }).prim!.sides).toBe(3);
  });
});

describe('merged shape tools: angle handles (Inkscape rules)', () => {
  const at = (s: VectorShape, deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [s.x + s.w / 2 + r * (s.w / 2) * Math.cos(a), s.y + s.h / 2 + r * (s.h / 2) * Math.sin(a)] as [number, number];
  };
  it('a handle dragged outside makes a slice, inside an arc, near the edge keeps the kind', () => {
    const s = prim({ kind: 'arc', a0: 0, a1: 90 });
    expect(primKnotDrag(s as ShapeSpec, 'to', at(s, 100, 1.5))!.prim!.kind).toBe('sector');
    expect(primKnotDrag(s as ShapeSpec, 'to', at(s, 100, 0.5))!.prim!.kind).toBe('arc');
    const sl = prim({ kind: 'sector', a0: 0, a1: 90 });
    expect(primKnotDrag(sl as ShapeSpec, 'to', at(sl, 100, 1.05))!.prim!.kind).toBe('sector');
    expect(primKnotDrag(sl as ShapeSpec, 'to', at(sl, 100, 0.5))!.prim!.kind).toBe('arc');
  });
  it('a chord keeps its kind', () => {
    const c = prim({ kind: 'chord', a0: 0, a1: 90 });
    expect(primKnotDrag(c as ShapeSpec, 'to', at(c, 100, 0.4))!.prim!.kind).toBe('chord');
  });
  it('angles that are nearly equal show one handle (whole)', () => {
    expect(primKnots(prim({ kind: 'arc', a0: 20, a1: 20 + 1e-6 }) as ShapeSpec)).toHaveLength(1);
    expect(primKnots(prim({ kind: 'arc', a0: 0, a1: 359.9 }) as ShapeSpec)).toHaveLength(2);
  });
});
