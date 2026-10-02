import { describe, expect, it } from 'vitest';
import { snapBox } from '../src/engine/design/snap';

describe('snap while moving a layer', () => {
  const targets = { xs: [0, 500, 1000], ys: [0, 300, 600] };
  it('sticks the nearest edge or center within the threshold, and says where', () => {
    expect(snapBox({ x: 4, y: 100, w: 200, h: 50 }, targets, 6)).toEqual({ dx: -4, dy: 0, gx: 0 });
    expect(snapBox({ x: 397, y: 272, w: 200, h: 50 }, targets, 6)).toEqual({ dx: 3, dy: 3, gx: 500, gy: 300 }); // centers
  });
  it('leaves it alone when nothing is close', () => {
    expect(snapBox({ x: 40, y: 100, w: 200, h: 50 }, targets, 6)).toEqual({ dx: 0, dy: 0 });
  });
});
