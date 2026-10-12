import { describe, expect, it } from 'vitest';
import { clipTo, EMPTY, fxMargin, grow, isEmpty, union } from '../src/engine/design/retainedPage';
import { newFxOp } from '../src/engine/fx/commands';

describe('FX margins (Paso 3)', () => {
  it('tone and colour ops reach nothing', () => {
    for (const k of ['brightness', 'contrast', 'saturation', 'hue', 'grayscale', 'sepia', 'invert', 'levels', 'curves'] as const) {
      expect(fxMargin(newFxOp(k, {}), 1)).toBe(0);
    }
  });
  it('blur reaches three sigma at composition scale', () => {
    expect(fxMargin(newFxOp('blur', { radius: 2 }), 1)).toBe(6);
    expect(fxMargin(newFxOp('blur', { radius: 2 }), 0.5)).toBe(3);
  });
  it('shadow reaches its offset plus three times its blur', () => {
    expect(fxMargin(newFxOp('shadow', { x: 6, y: 4, blur: 10 }), 1)).toBe(36);
    expect(fxMargin(newFxOp('shadow', { x: -20, y: 2, blur: 5 }), 2)).toBe(70);
  });
  it('a disabled op reaches nothing', () => {
    expect(fxMargin({ ...newFxOp('blur', { radius: 9 }), enabled: false }, 1)).toBe(0);
  });
  it('glow and flare are unknown: a full frame, never a guess', () => {
    expect(fxMargin(newFxOp('glow', { radius: 8 }), 1)).toBe(Infinity);
    expect(fxMargin(newFxOp('flare', {}), 1)).toBe(Infinity);
  });
});

describe('rectangle arithmetic', () => {
  it('unions, grows and clips', () => {
    expect(union({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 5, y0: -2, x1: 20, y1: 4 })).toEqual({ x0: 0, y0: -2, x1: 20, y1: 10 });
    expect(union(null, EMPTY)).toBeNull();
    expect(grow({ x0: 10, y0: 10, x1: 20, y1: 20 }, 3)).toEqual({ x0: 7, y0: 7, x1: 23, y1: 23 });
    expect(clipTo({ x0: -5, y0: -5, x1: 50, y1: 50 }, 40, 30)).toEqual({ x0: 0, y0: 0, x1: 40, y1: 30 });
    expect(isEmpty(clipTo({ x0: 50, y0: 50, x1: 60, y1: 60 }, 40, 30))).toBe(true);
  });
  it('an infinite margin makes the region the whole plane', () => {
    expect(grow({ x0: 1, y0: 1, x1: 2, y1: 2 }, Infinity).x0).toBe(-Infinity);
  });
});
