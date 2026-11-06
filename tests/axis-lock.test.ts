import { describe, expect, it } from 'vitest';
import { keepAxis, lockedAxis, lockedDelta, lockedPoint } from '../src/engine/design/axisLock';

const gate = (shift = false) => ({ shift, alt: false, ctrl: false });
const on = { shiftKey: true }, off = { shiftKey: false };

describe('axis lock', () => {
  it('without Shift nothing changes', () => {
    expect(lockedDelta(5, 9, off, gate())).toEqual({ dx: 5, dy: 9 });
    expect(lockedAxis(5, 9, off, gate())).toBeNull();
  });
  it('Shift locks to the dominant axis, live', () => {
    expect(lockedDelta(9, -5, on, gate())).toEqual({ dx: 9, dy: 0 });
    expect(lockedDelta(2, -5, on, gate())).toEqual({ dx: 0, dy: -5 });
    expect(lockedDelta(4, 4, on, gate())).toEqual({ dx: 4, dy: 0 });
  });
  it('Shift held at pointer down is the mode, until released and pressed anew', () => {
    const g = gate(true);
    expect(lockedDelta(9, 1, on, g)).toEqual({ dx: 9, dy: 1 });
    expect(lockedDelta(9, 1, off, g)).toEqual({ dx: 9, dy: 1 });
    expect(lockedDelta(9, 1, on, g)).toEqual({ dx: 9, dy: 0 });
  });
  it('the locked axis stays after a snap', () => {
    expect(keepAxis({ dx: 3, dy: 2 }, 'x')).toEqual({ dx: 3, dy: 0 });
    expect(keepAxis({ dx: 3, dy: 2 }, 'y')).toEqual({ dx: 0, dy: 2 });
    expect(keepAxis({ dx: 3, dy: 2 }, null)).toEqual({ dx: 3, dy: 2 });
  });
  it('lockedPoint returns the same point when nothing locks, else a point on the axis', () => {
    const p = { x: 10, y: 4 };
    expect(lockedPoint(p, { x: 0, y: 0 }, off, gate())).toBe(p);
    expect(lockedPoint(p, { x: 0, y: 0 }, on, gate())).toEqual({ x: 10, y: 0 });
  });
});
