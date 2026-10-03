import { describe, expect, it } from 'vitest';
import { arrowPath, curvePath, pathBox, polygonPath } from '../src/engine/design/shapeTools';

describe('shape tools', () => {
  it('a pentagon fills its box (top corner centred), and its box reads back', () => {
    const d = polygonPath(0, 0, 100, 100, 5);
    expect(d.match(/L/g)).toHaveLength(4);
    expect(d.startsWith('M 50 0 ')).toBe(true);
    const b = pathBox(d)!;
    expect(b.y).toBe(0);
    expect(Math.round(b.x + b.w / 2)).toBe(50);
  });
  it('a curve bows to one side or the other; a straight arrow has a head at its end', () => {
    expect(pathBox(curvePath(0, 0, 100, 0, 0.3))!.y + pathBox(curvePath(0, 0, 100, 0, 0.3))!.h).toBeGreaterThan(30);
    expect(pathBox(curvePath(0, 0, 100, 0, -0.3))!.y).toBeLessThan(-30);
    const a = arrowPath(0, 0, 100, 0, 4);
    expect(a.split('M')).toHaveLength(3);
    expect(pathBox(a)!.x + pathBox(a)!.w).toBe(100);
  });
});
