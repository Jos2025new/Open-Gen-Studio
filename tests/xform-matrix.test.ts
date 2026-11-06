import { describe, expect, it } from 'vitest';
import { xformMatrix, type XformDrag } from '../src/engine/design/xformMatrix';

const box = { x: 0, y: 0, w: 100, h: 50 };
const drag = (fx: number, fy: number): XformDrag => ({ op: 'scale', h: { x: box.x + box.w / 2 + (fx * box.w) / 2, y: box.y + box.h / 2 + (fy * box.h) / 2, fx, fy }, startX: 0, startY: 0, cx: 50, cy: 25, box });
const none = { shift: false, alt: false };
const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

describe('xformMatrix scale', () => {
  it('keeps the opposite corner by default', () => {
    const m = xformMatrix(drag(1, 1), { x: 200, y: 100 }, none);
    expect(apply(m, 0, 0)).toEqual([0, 0]);
    expect(apply(m, 100, 50)).toEqual([200, 100]);
  });
  it('Alt keeps the centre: both sides move', () => {
    const m = xformMatrix(drag(1, 1), { x: 150, y: 75 }, { shift: false, alt: true });
    expect(apply(m, 50, 25)).toEqual([50, 25]);
    expect(apply(m, 100, 50)).toEqual([150, 75]);
    expect(apply(m, 0, 0)).toEqual([-50, -25]);
  });
  it('Alt with a side handle scales that axis about the centre', () => {
    const m = xformMatrix(drag(1, 0), { x: 150, y: 25 }, { shift: false, alt: true });
    expect(apply(m, 0, 0)).toEqual([-50, 0]);
    expect(apply(m, 50, 25)).toEqual([50, 25]);
  });
  it('Alt+Shift on a side handle keeps proportions about the centre', () => {
    const m = xformMatrix(drag(1, 0), { x: 150, y: 25 }, { shift: true, alt: true });
    expect(apply(m, 50, 25)).toEqual([50, 25]);
    expect(m[0]).toBeCloseTo(2); expect(m[3]).toBeCloseTo(2);
  });
});
