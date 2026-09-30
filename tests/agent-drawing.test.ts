import { describe, expect, it } from 'vitest';
import { parsePath, pathTransform } from '../src/engine/design/path';
import { normalizeShapes, normalizeStrokes } from '../src/engine/plan';

describe('agent drawing in the Designer', () => {
  it('reads the box of an absolute path and rejects what it cannot place', () => {
    expect(parsePath('M 10 20 C 50 0 90 40 110 20 L 60 80 Z')).toEqual({ box: { x: 10, y: 0, w: 100, h: 80 } });
    expect('error' in parsePath('m 10 20 l 5 5')).toBe(true);
    expect('error' in parsePath('L 10 20')).toBe(true);
    expect('error' in parsePath('M 10 20 C 1 2')).toBe(true);
    expect('error' in parsePath('M 10 20 <script>')).toBe(true);
  });

  it('path shapes keep their own coordinates and follow moves and scales', () => {
    const errors: string[] = [];
    const [s] = normalizeShapes([{ type: 'path', d: 'M 0 0 L 100 50', stroke: '#ff0000' }], errors);
    expect(errors).toEqual([]);
    expect(s).toMatchObject({ type: 'path', x: 0, y: 0, w: 100, h: 50, stroke: '#ff0000', strokeWidth: 4 });
    expect(pathTransform({ ...s, x: 10, y: 20, w: 200, h: 50 })).toEqual({ sx: 2, sy: 1, tx: 10, ty: 20 });
    const bad: string[] = [];
    expect(normalizeShapes([{ type: 'path', d: 'Q 1 2' }], bad)).toEqual([]);
    expect(bad[0]).toMatch(/path is invalid/);
  });

  it('normalizes freehand strokes with or without pressure', () => {
    const errors: string[] = [];
    const [a, b] = normalizeStrokes([{ points: [[0, 0], [10, 5]], color: '#000000', size: 6 }, { points: [[1, 1, 0.2], [2, 2, 3]] }], errors);
    expect(errors).toEqual([]);
    expect(a).toMatchObject({ pressure: false, color: '#000000', size: 6 });
    expect(b.pressure).toBe(true);
    expect(b.points[1][2]).toBe(1);
    const empty: string[] = [];
    expect(normalizeStrokes([{ points: [] }], empty)).toEqual([]);
    expect(empty[0]).toMatch(/needs "points"/);
  });
});
