import { describe, expect, it, vi } from 'vitest';
import { pixelBox } from '../src/engine/design/render';

function pixels(width: number, height: number, box: { x0: number; y0: number; x1: number; y1: number }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) data[(y * width + x) * 4 + 3] = 255;
  return { data };
}

describe('raster pixel bounds', () => {
  it('refreshes at a new content version even before 150 ms on the clock', () => {
    const first = pixels(10, 6, { x0: 1, y0: 1, x1: 3, y1: 2 });
    const next = pixels(10, 6, { x0: 7, y0: 3, x1: 9, y1: 5 });
    const getImageData = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(next);
    const canvas = { width: 10, height: 6, getContext: () => ({ getImageData }) } as unknown as HTMLCanvasElement;
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);

    expect(pixelBox(canvas, 1)).toEqual({ x0: 1, y0: 1, x1: 3, y1: 2 });
    now.mockReturnValue(149);
    expect(pixelBox(canvas, 2)).toEqual({ x0: 7, y0: 3, x1: 9, y1: 5 });
    expect(getImageData).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });
});
