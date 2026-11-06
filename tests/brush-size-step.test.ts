import { describe, expect, it } from 'vitest';
import { sizeRangeFor, stepBrushSize } from '../src/engine/design/brushSizeStep';

describe('brush size step', () => {
  it('steps by about 7 %, at least 1 px', () => {
    expect(stepBrushSize(5, 1)).toBe(6);
    expect(stepBrushSize(5, -1)).toBe(4);
    expect(stepBrushSize(150, 1)).toBe(160);
    expect(stepBrushSize(150, -1)).toBe(140);
  });
  it('stays within 1..1000', () => {
    expect(stepBrushSize(1, -1)).toBe(1);
    expect(stepBrushSize(1000, 1)).toBe(1000);
    expect(stepBrushSize(995, 1)).toBe(1000);
  });
  it('always moves while there is room', () => {
    for (let s = 2; s < 1000; s++) { expect(stepBrushSize(s, 1)).toBeGreaterThan(s); expect(stepBrushSize(s, -1)).toBeLessThan(s); }
  });
  it('picks the range that holds the size', () => {
    expect(sizeRangeFor(150)).toBe(10);
    expect(sizeRangeFor(5, 10)).toBe(1);
    expect(sizeRangeFor(50, 10)).toBe(10);
    expect(sizeRangeFor(50)).toBe(1);
  });
});
