import { describe, expect, it } from 'vitest';
import { markerSvg, pathEnds, shapeEnds } from '../src/engine/design/markers';
import { shapeSvg } from '../src/engine/design/export';
import type { VectorShape } from '../src/engine/types';

const line = (over: Partial<VectorShape> = {}): VectorShape => ({ id: 'l1', type: 'line', x: 0, y: 0, w: 100, h: 0, fill: null, stroke: '#000000', strokeWidth: 2, radius: 0, ...over });
const path = (d: string, box0: { x: number; y: number; w: number; h: number }, over: Partial<VectorShape> = {}): VectorShape =>
  ({ id: 'p1', type: 'path', d, box0, x: box0.x, y: box0.y, w: box0.w, h: box0.h, fill: null, stroke: '#000000', strokeWidth: 2, radius: 0, ...over });

describe('arrowhead directions', () => {
  it('a straight line: each end points along the line, away from it', () => {
    const e = pathEnds('M 0 0 L 100 0')!;
    expect(e.start).toEqual([0, 0]);
    expect(e.startDir).toEqual([100, 0]);
    expect(e.end).toEqual([100, 0]);
    expect(e.endDir).toEqual([100, 0]);
  });

  it('a curve: the direction at each end comes from its own control point, not the far end', () => {
    const e = pathEnds('M 0 0 C 0 50 100 50 100 0')!;
    expect(e.startDir).toEqual([0, 50]);
    expect(e.endDir).toEqual([0, -50]);
  });

  it('a quadratic and an implicit line after M are read; a closed or empty path gives nothing', () => {
    expect(pathEnds('M 0 0 Q 50 50 100 0')!.endDir).toEqual([50, -50]);
    expect(pathEnds('M 0 0 10 0 20 0')!.end).toEqual([20, 0]);
    expect(pathEnds('M 5 5')).toBeNull();
  });

  it('a line reads its ends from its box diagonal', () => {
    expect(shapeEnds(line({ x: 10, y: 10, w: 0, h: 40 }))!.end).toEqual([10, 50]);
  });
});

describe('arrowheads in SVG', () => {
  it('no marker gives no definitions and leaves the shape alone', () => {
    expect(markerSvg(line(), 'm', '#000', (v) => v)).toEqual({ defs: '', attrs: '' });
    expect(shapeSvg(line())).not.toContain('marker');
  });

  it('an end arrow is a marker that points forward, and the line refers to it', () => {
    const svg = shapeSvg(line({ markerEnd: 'triangle' }));
    expect(svg).toContain('<marker id="mk-l1-e"');
    expect(svg).toContain('orient="auto"');
    expect(svg).toContain('markerUnits="strokeWidth"');
    expect(svg).toContain('marker-end="url(#mk-l1-e)"');
    expect(svg).not.toContain('marker-start');
  });

  it('a start arrow reverses with the path, and an open arrow is stroked', () => {
    const svg = shapeSvg(line({ markerStart: 'open', markerEnd: 'circle' }));
    expect(svg).toContain('orient="auto-start-reverse"');
    expect(svg).toContain('marker-start="url(#mk-l1-s)"');
    expect(svg).toContain('stroke-width="0.5"');
    expect(svg).toContain('<circle');
  });

  it('a marker on a path is attached to the path element itself', () => {
    const svg = shapeSvg(path('M 0 0 L 10 0', { x: 0, y: 0, w: 10, h: 1 }, { markerEnd: 'bar' }));
    expect(svg).toMatch(/<path d="M 0 0 L 10 0" transform="[^"]*"[^>]*marker-end="url\(#mk-p1-e\)"/);
  });

  it('a shape without stroke gets no markers', () => {
    expect(shapeSvg(line({ stroke: null, strokeWidth: 0, markerEnd: 'square' }))).not.toContain('marker');
  });
});

describe('scale stroke', () => {
  it('by default a scaled path keeps its stroke width; with Scale stroke it grows with the path', () => {
    // The path's own box is 10 × 10 and it is drawn 20 × 20: uniform scale 2.
    const drawn = { x: 0, y: 0, w: 20, h: 20 };
    const kept = shapeSvg(path('M 0 0 L 10 0', { x: 0, y: 0, w: 10, h: 10 }, drawn));
    const grown = shapeSvg(path('M 0 0 L 10 0', { x: 0, y: 0, w: 10, h: 10 }, { ...drawn, scaleStroke: true }));
    expect(kept).toContain('stroke-width="1"');
    expect(grown).toContain('stroke-width="2"');
  });
});
