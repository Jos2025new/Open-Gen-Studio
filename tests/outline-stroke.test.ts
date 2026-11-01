import { describe, expect, it } from 'vitest';
import type { VectorShape } from '../src/engine/types';
import { canOutlineStroke, outlineStrokeShapes, strokeOutlineShape } from '../src/engine/design/outlineStroke';

const shape = (o: Partial<VectorShape>): VectorShape => ({ id: 's', type: 'rect', x: 0, y: 0, w: 100, h: 50, fill: null, stroke: '#123456', strokeWidth: 10, radius: 0, ...o });

/** Nonzero winding of the outline's subpaths at a point: what a fill of the result paints. */
function painted(d: string, x: number, y: number): boolean {
  let wn = 0;
  for (const sub of d.split('M').slice(1)) {
    const pts = sub.replace('Z', '').split('L').map((p) => p.trim().split(/\s+/).map(Number));
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      if (y0 <= y ? y1 > y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0 : y1 <= y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0) wn += y0 <= y ? 1 : -1;
    }
  }
  return wn !== 0;
}

describe('outline stroke', () => {
  it('turns the stroke into a filled path with its paint and no stroke', () => {
    const o = strokeOutlineShape(shape({ strokeOpacity: 0.5 }))!;
    expect(o.type).toBe('path');
    expect(o).toMatchObject({ fill: '#123456', fillOpacity: 0.5, stroke: null, strokeWidth: 0 });
    expect(o.dash).toBeUndefined();
  });

  it('covers exactly the band around a rectangle: miter corners reach out, bevel corners are cut', () => {
    const miter = strokeOutlineShape(shape({ join: 'miter' }))!.d!;
    expect(painted(miter, 50, 0)).toBe(true);
    expect(painted(miter, 50, 4)).toBe(true);
    expect(painted(miter, 50, 6)).toBe(false);
    expect(painted(miter, 50, 25)).toBe(false);
    expect(painted(miter, -4, -4)).toBe(true);
    const bevel = strokeOutlineShape(shape({ join: 'bevel' }))!.d!;
    expect(painted(bevel, -4, -4)).toBe(false);
    expect(painted(bevel, -2, -2)).toBe(true);
  });

  it('follows curves: a circle of radius 50 and width 10 paints radii 45–55', () => {
    const d = strokeOutlineShape(shape({ type: 'ellipse', w: 100, h: 100 }))!.d!;
    for (const [r, on] of [[44, false], [46, true], [54, true], [56, false]] as const) expect(painted(d, 50 + r, 50), `r=${r}`).toBe(on);
  });

  it('caps and dashes: open ends, square reach, gaps', () => {
    const line = shape({ type: 'line', w: 100, h: 0, cap: 'butt' });
    expect(painted(strokeOutlineShape(line)!.d!, -2, 0)).toBe(false);
    expect(painted(strokeOutlineShape({ ...line, cap: 'square' })!.d!, -2, 0)).toBe(true);
    expect(painted(strokeOutlineShape({ ...line, cap: 'round' })!.d!, -2, 0)).toBe(true);
    const dashes = strokeOutlineShape({ ...line, dash: [1, 1] })!.d!; // 10 px on, 10 px off
    expect(painted(dashes, 5, 0)).toBe(true);
    expect(painted(dashes, 15, 0)).toBe(false);
    expect(painted(dashes, 25, 0)).toBe(true);
  });

  it('refuses what it cannot outline: no stroke, or an inside / outside stroke', () => {
    expect(canOutlineStroke(shape({ stroke: null }))).toBe(false);
    expect(canOutlineStroke(shape({ strokeWidth: 0 }))).toBe(false);
    expect(canOutlineStroke(shape({ strokeAlign: 'inside' }))).toBe(false);
    expect(strokeOutlineShape(shape({ stroke: null }))).toBeNull();
  });

  it('with a fill keeps it as its own shape and adds the outline above; without, replaces in place', () => {
    const filled = outlineStrokeShapes([shape({ fill: '#fff' })], 's');
    expect(filled).toHaveLength(2);
    expect(filled[0]).toMatchObject({ id: 's', fill: '#fff', stroke: null, strokeWidth: 0 });
    expect(filled[1]).toMatchObject({ type: 'path', fill: '#123456' });
    expect(filled[1].id).not.toBe('s');
    const under = outlineStrokeShapes([shape({ fill: '#fff', paintOrder: 'stroke' })], 's');
    expect(under[1].id).toBe('s');
    const bare = outlineStrokeShapes([shape({})], 's');
    expect(bare).toHaveLength(1);
    expect(bare[0]).toMatchObject({ id: 's', type: 'path', fill: '#123456' });
  });
});
