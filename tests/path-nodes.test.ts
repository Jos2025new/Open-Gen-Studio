import { describe, expect, it } from 'vitest';
import type { ShapeSpec } from '../src/engine/types';
import { moveNodePoint, nodePoints, pageSegs, parseSegs, serializeSegs, withSegs } from '../src/engine/design/pathNodes';
import { shapeToPath } from '../src/engine/design/affine';

/* Inkscape's Node tool on path shapes (pathNodes.ts). */
const path = (d: string, o: Partial<ShapeSpec> = {}): ShapeSpec => ({ type: 'path', d, x: 0, y: 0, w: 0, h: 0, fill: '#000', stroke: null, strokeWidth: 0, radius: 0, ...withBox(d), ...o });
function withBox(d: string) { const s = withSegs({ type: 'path', x: 0, y: 0, w: 1, h: 1, fill: null, stroke: null, strokeWidth: 0, radius: 0 } as ShapeSpec, parseSegs(d)); return { box0: s.box0, x: s.x, y: s.y, w: s.w, h: s.h }; }

describe('path nodes', () => {
  it('S and T become explicit C and Q (every control point can be dragged); the path draws the same', () => {
    expect(serializeSegs(parseSegs('M 0 0 C 0 10 10 10 10 0 S 20 -10 20 0'))).toBe('M 0 0 C 0 10 10 10 10 0 C 10 -10 20 -10 20 0');
    expect(serializeSegs(parseSegs('M 0 0 Q 5 10 10 0 T 20 0'))).toBe('M 0 0 Q 5 10 10 0 Q 15 -10 20 0');
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

  it('Convert to path: a rounded rectangle and an ellipse give nodes with curve handles', () => {
    const rect = shapeToPath({ type: 'rect', x: 0, y: 0, w: 100, h: 60, fill: '#000', stroke: null, strokeWidth: 0, radius: 0, rx: 10, ry: 10 });
    const pts = nodePoints(pageSegs(rect));
    expect(pts.filter((p) => p.kind === 'node')).toHaveLength(8);
    expect(pts.filter((p) => p.kind === 'handle')).toHaveLength(8);
    const ell = shapeToPath({ type: 'ellipse', x: 0, y: 0, w: 100, h: 60, fill: '#000', stroke: null, strokeWidth: 0, radius: 0 });
    expect(nodePoints(pageSegs(ell)).filter((p) => p.kind === 'node')).toHaveLength(4);
  });
});
