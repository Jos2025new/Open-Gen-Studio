import { describe, expect, it } from 'vitest';
import { layMask, lockAlpha } from '../src/engine/design/rasterDraw';
import { pixelCanvas } from './helpers/pixelCanvas';

/* Keep Opacity is a strict alpha lock: the stroke changes colour, never the alpha the layer had. */

const canvasOf = (alphas: number[]) => {
  const c = pixelCanvas(alphas.length, 1);
  alphas.forEach((a, i) => { c.pixels[i] = a; });
  return c;
};

describe('Keep Opacity (alpha lock)', () => {
  it('keeps semi-transparent pixels as they were, under and beside the paint', () => {
    const layer = canvasOf([0, 0.5, 0.5, 1]);
    const mask = canvasOf([1, 1, 0, 1]), before = canvasOf([0, 0.5, 0.5, 1]);
    layMask(layer.getContext() as unknown as CanvasRenderingContext2D, mask as unknown as HTMLCanvasElement, 0, 0, 0, 0, 4, 1, { hardness: 1, keepOpacity: true }, 1, false, before as unknown as HTMLCanvasElement);
    expect([...layer.pixels]).toEqual([0, 0.5, 0.5, 1]);
  });

  it('with a blend mode, puts back the alpha from before the stroke', () => {
    const painted = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 200, 1, 2, 3, 9]);
    lockAlpha(painted, new Uint8ClampedArray([0, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 9]));
    expect([...painted]).toEqual([10, 20, 30, 128, 40, 50, 60, 0, 1, 2, 3, 9]);
  });
});
