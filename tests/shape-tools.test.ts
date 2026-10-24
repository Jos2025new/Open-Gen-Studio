import { describe, expect, it } from 'vitest';
import { arrowPath, curvePath, pathBox, toolPath } from '../src/engine/design/shapeTools';

describe('shape tools', () => {
  it('a curve bows to one side or the other; a straight arrow has a head at its end', () => {
    expect(pathBox(curvePath(0, 0, 100, 0, 0.3))!.y + pathBox(curvePath(0, 0, 100, 0, 0.3))!.h).toBeGreaterThan(30);
    expect(pathBox(curvePath(0, 0, 100, 0, -0.3))!.y).toBeLessThan(-30);
    const a = arrowPath(0, 0, 100, 0, 4);
    expect(a.split('M')).toHaveLength(3);
    expect(pathBox(a)!.x + pathBox(a)!.w).toBe(100);
  });
  it('the path tools are the curve and the arrow only (polygons are primitives)', () => {
    expect(toolPath('arrow', 0, 0, 100, 0, { bend: 0, strokeWidth: 4 })).toBe(arrowPath(0, 0, 100, 0, 4));
    expect(toolPath('curve', 0, 0, 100, 0, { bend: 0.3, strokeWidth: 4 })).toBe(curvePath(0, 0, 100, 0, 0.3));
  });
});
