import { describe, expect, it } from 'vitest';
import { brushPoint } from '../src/engine/design/brushControl';
const origin = { x: 0, y: 0 };
describe('raster brush control', () => {
  it('preserves the original brush at zero levels', () => {
    expect(brushPoint(origin, origin, { x: 23, y: 19 }, 0, 0, 1, 0).paint).toEqual({ x: 23, y: 19 });
  });
  it('rejects jitter inside the stabilization radius and follows beyond it', () => {
    expect(brushPoint(origin, origin, { x: 3, y: 4 }, 0, 5, 1, 16).paint).toEqual(origin);
    expect(brushPoint(origin, origin, { x: 30, y: 0 }, 0, 5, 1, 16).paint).toEqual({ x: 20, y: 0 });
  });
  it('keeps the stabilization distance consistent on screen at different zooms', () => {
    expect(brushPoint(origin, origin, { x: 15, y: 0 }, 0, 5, 2, 16).paint.x * 2).toBe(20);
  });
  it('gives stronger smoothing more weight and is independent of sampling frequency for a stationary target', () => {
    const input = { x: 100, y: 0 };
    const slow = brushPoint(origin, origin, input, 10, 0, 1, 16).paint;
    const fast = brushPoint(origin, origin, input, 2, 0, 1, 16).paint;
    expect(slow.x).toBeLessThan(fast.x);
    const first = brushPoint(origin, origin, input, 10, 0, 1, 8);
    const second = brushPoint(first.paint, first.control, input, 10, 0, 1, 8);
    expect(second.paint.x).toBeCloseTo(slow.x, 10);
  });
});
