import { describe, expect, it, vi } from 'vitest';
import { ctx2d, setCpuCanvases } from '../src/lib/media';

/*
 * Engine canvases use GPU contexts by default. The parity oracle and the bench's CPU variant switch them to CPU
 * contexts (setCpuCanvases): Chromium's GPU rasterizer is not bit-for-bit deterministic (docs/render-baseline.md).
 */
describe('engine canvases', () => {
  const canvasWith = () => {
    const ctx = {} as CanvasRenderingContext2D;
    const getContext = vi.fn(() => ctx);
    return { ctx, getContext, canvas: { getContext } as unknown as HTMLCanvasElement };
  };
  it('uses a GPU 2D context by default', () => {
    const { ctx, getContext, canvas } = canvasWith();
    expect(ctx2d(canvas)).toBe(ctx);
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: false });
  });
  it('uses a CPU context only when the oracle or bench asks for it', () => {
    const on = canvasWith();
    setCpuCanvases(true);
    ctx2d(on.canvas);
    setCpuCanvases(false);
    expect(on.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    const off = canvasWith();
    ctx2d(off.canvas);
    expect(off.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: false });
  });
});
