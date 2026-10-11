import { describe, expect, it } from 'vitest';
import type { ShapeSpec } from '../src/engine/types';
import { moveNodePoint, nodePoints, pageSegs, parseSegs, serializeSegs, withSegs } from '../src/engine/design/pathNodes';
import { shapeToPath } from '../src/engine/design/affine';
import { toPage } from '../src/engine/design/shapeTransform';

/* Inkscape's Node tool on path shapes (pathNodes.ts). */
const path = (d: string, o: Partial<ShapeSpec> = {}): ShapeSpec => ({ type: 'path', d, fill: '#000', stroke: null, strokeWidth: 0, radius: 0, ...withBox(d), ...o });
function withBox(d: string) { const s = withSegs({ type: 'path', x: 0, y: 0, w: 1, h: 1, fill: null, stroke: null, strokeWidth: 0, radius: 0 } as ShapeSpec, parseSegs(d)); return { box0: s.box0, x: s.x, y: s.y, w: s.w, h: s.h }; }

describe('path nodes', () => {
  it('S, Q and T become the same cubics (Inkscape edits every curve as cubic): each end gets its own handle', () => {
    expect(serializeSegs(parseSegs('M 0 0 C 0 10 10 10 10 0 S 20 -10 20 0'))).toBe('M 0 0 C 0 10 10 10 10 0 C 10 -10 20 -10 20 0');
    expect(serializeSegs(parseSegs('M 0 0 Q 6 9 12 0 T 24 0'))).toBe('M 0 0 C 4 6 8 6 12 0 C 16 -6 20 -6 24 0');
  });

  it('review: moving the end node of a Curve (quadratic) carries its handle', () => {
    const segs = parseSegs('M 0 0 Q 6 9 12 0');
    expect(serializeSegs(moveNodePoint(segs, { kind: 'node', seg: 1, k: 2 }, 3, -3))).toBe('M 0 0 C 4 6 11 3 15 -3');
  });

  it('nodes at segment ends, handles hanging from their node; a closing twin of the start is one node', () => {
    const pts = nodePoints(parseSegs('M 0 0 C 0 10 10 10 10 0 L 0 0 Z'));
    expect(pts.filter((p) => p.kind === 'node').map((p) => p.at)).toEqual([[0, 0], [10, 0]]);
    expect(pts.filter((p) => p.kind === 'handle').map((p) => [p.at, p.from])).toEqual([[[0, 10], [0, 0]], [[10, 10], [10, 0]]]);
  });

  it('dragging a node carries its handles; a handle moves alone; the closed start moves with its twin', () => {
    const segs = parseSegs('M 0 0 C 0 10 10 10 10 0 C 10 -10 0 -10 0 0 Z');
    expect(serializeSegs(moveNodePoint(segs, { kind: 'node', seg: 1, k: 2 }, 5, 1))).toBe('M 0 0 C 0 10 15 11 15 1 C 15 -9 0 -10 0 0 Z');
    expect(serializeSegs(moveNodePoint(segs, { kind: 'handle', seg: 1, k: 0 }, 3, 0))).toBe('M 0 0 C 3 10 10 10 10 0 C 10 -10 0 -10 0 0 Z');
    expect(serializeSegs(moveNodePoint(segs, { kind: 'node', seg: 0, k: 0 }, 2, 2))).toBe('M 2 2 C 2 12 10 10 10 0 C 10 -10 2 -8 2 2 Z');
  });

  it('edits in page coordinates: a moved and scaled path keeps where it sits; the result is a plain path', () => {
    const s = { ...path('M 0 0 L 10 0 L 10 10 Z'), x: 100, y: 50, w: 20, h: 20 };
    expect(serializeSegs(pageSegs(s))).toBe('M 100 50 L 120 50 L 120 70 Z');
    const out = withSegs(s, moveNodePoint(pageSegs(s), { kind: 'node', seg: 2, k: 0 }, 10, 0));
    expect([out.x, out.y, out.w, out.h]).toEqual([100, 50, 30, 20]);
    expect(out.box0).toEqual({ x: 100, y: 50, w: 30, h: 20 });
  });

  it('review of b904858: dragging one node of a turned path leaves every other node where it was on the page', () => {
    const c = Math.cos(0.5), sn = Math.sin(0.5);
    const s: ShapeSpec = { ...path('M 0 0 L 100 0 L 100 60 L 0 60 Z'), rot: [c, sn, -sn, c] };
    const before = nodePoints(pageSegs(s)).map((p) => toPage(s, ...p.at));
    const out = withSegs(s, moveNodePoint(pageSegs(s), { kind: 'node', seg: 2, k: 0 }, 30, 20));
    const after = nodePoints(pageSegs(out)).map((p) => toPage(out, ...p.at));
    for (const i of [0, 1, 3]) { expect(after[i][0]).toBeCloseTo(before[i][0], 1); expect(after[i][1]).toBeCloseTo(before[i][1], 1); }
    expect(Math.hypot(after[2][0] - before[2][0], after[2][1] - before[2][1])).toBeGreaterThan(30);
  });

  it('Convert to path: a rounded rectangle and an ellipse give nodes with curve handles', () => {
    const rect = shapeToPath({ type: 'rect', x: 0, y: 0, w: 100, h: 60, fill: '#000', stroke: null, strokeWidth: 0, radius: 0, rx: 10, ry: 10 });
    const pts = nodePoints(pageSegs(rect));
    expect(pts.filter((p) => p.kind === 'node')).toHaveLength(8);
    expect(pts.filter((p) => p.kind === 'handle')).toHaveLength(8);
    const ell = shapeToPath({ type: 'ellipse', x: 0, y: 0, w: 100, h: 60, fill: '#000', stroke: null, strokeWidth: 0, radius: 0 });
    expect(nodePoints(pageSegs(ell)).filter((p) => p.kind === 'node')).toHaveLength(4);
  });
});
