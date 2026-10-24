import { describe, expect, it } from 'vitest';
import { marqueeBounds, marqueeIds } from '../src/engine/design/marquee';

const targets = [
  { id: 'inside', box: { x: 20, y: 20, w: 10, h: 10 } },
  { id: 'crossed', box: { x: 45, y: 20, w: 20, h: 10 } },
  { id: 'outside', box: { x: 80, y: 80, w: 10, h: 10 } },
];

describe('Edit marquee geometry', () => {
  it('normalizes all drag directions and selects the same fully enclosed targets', () => {
    expect(marqueeBounds(10, 10, 50, 50)).toEqual({ left: 10, top: 10, right: 50, bottom: 50 });
    expect(marqueeIds(targets, 10, 10, 40, 50)).toEqual(['inside']);
    expect(marqueeIds(targets, 40, 50, 10, 10)).toEqual(['inside']);
  });

  it('encloses are found; a target that only crosses is found too, in either direction (touch semantics)', () => {
    expect(marqueeIds(targets, 40, 10, 55, 50)).toEqual(['crossed']);
    expect(marqueeIds(targets, 55, 50, 40, 10)).toEqual(['crossed']);
    expect(marqueeIds(targets, 60, 10, 90, 50)).toEqual(['crossed']);
    expect(marqueeIds(targets, 0, 60, 15, 70)).toEqual([]);
  });
});
