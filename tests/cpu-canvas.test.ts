import { describe, expect, it, vi } from 'vitest';
import { ctx2d } from '../src/lib/media';

/*
 * The editor reads its canvases back (hit tests, bounds, exports). Chromium's GPU-backed canvases can give other
 * pixels than CPU-backed ones, and the same document then composes differently between two calls (measured with
 * bench/engines: cached against uncached, 85 of 200 changes; 0 with CPU canvases). So every engine canvas asks for a
 * CPU context.
 */
describe('engine canvases', () => {
  it('asks for a CPU-backed 2D context', () => {
    const ctx = {} as CanvasRenderingContext2D;
    const getContext = vi.fn(() => ctx);
    expect(ctx2d({ getContext } as unknown as HTMLCanvasElement)).toBe(ctx);
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
  });
});
