import { describe, expect, it } from 'vitest';
import { shapeSvg } from '../src/engine/design/export';
import { arrowPath, curvePath } from '../src/engine/design/shapeTools';
import { primPath, primShape, type PrimSpec } from '../src/engine/design/primitives';
import type { VectorShape } from '../src/engine/types';

/*
 * Compatibility proof for the merged shape tools: documents keep the kinds sector, arc, chord, polygon, star, arrow and
 * ellipse, and they render and export byte for byte as they did before the merge. The hashes were taken from the
 * code before the merge (commit 42739ac).
 */
/** FNV-1a, 32 bits: enough to notice any change of the exported text. */
const sha = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16); };
const look = { id: 's', fill: '#ff0000', stroke: '#000000', strokeWidth: 2, radius: 0 };
const PRIMS: PrimSpec[] = [
  { kind: 'sector', a0: 0, a1: 270 }, { kind: 'sector', a0: 300, a1: 60 }, { kind: 'sector', a0: 30, a1: 30 },
  { kind: 'arc', a0: 0, a1: 359.9 }, { kind: 'arc', a0: 90, a1: 10 }, { kind: 'chord', a0: 10, a1: 200 }, { kind: 'chord', a0: 0, a1: 0 },
  { kind: 'polygon', sides: 3 }, { kind: 'polygon', sides: 24, round: 0.5 }, { kind: 'star', sides: 5, inner: 0.5 }, { kind: 'star', sides: 24, inner: 0.1, round: 1 },
];
const GOLDEN: Record<string, string> = {
  '0:sector': 'bedcd4c5',
  '1:sector': 'f0aab931',
  '2:sector': 'd7e758b9',
  '3:arc': '3de9de51',
  '4:arc': 'e0f270f9',
  '5:chord': 'c2eccea1',
  '6:chord': '9b788d2d',
  '7:polygon': '62828799',
  '8:polygon': 'bda10a9',
  '9:star': '484f2de9',
  '10:star': '451603ef',
};

describe('compatibility of stored shape kinds', () => {
  it('prim paths and their SVG export are unchanged', () => {
    const got = PRIMS.map((p, i) => {
      const s = { ...primShape(10, 20, 110, 90, p), ...look } as VectorShape;
      return [`${i}:${p.kind}`, sha(primPath(p) + '|' + shapeSvg(s))];
    });
    expect(Object.fromEntries(got)).toEqual(GOLDEN);
  });
  it('ellipse, line and arrow export unchanged', () => {
    const e = shapeSvg({ id: 'e', type: 'ellipse', x: 1, y: 2, w: 30, h: 20, fill: '#fff', stroke: '#000', strokeWidth: 1, radius: 0 } as VectorShape);
    expect(sha(e + arrowPath(0, 0, 100, 40, 4) + curvePath(0, 0, 100, 0, 0.3))).toBe('f91655be');
  });
});
