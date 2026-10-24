import { describe, expect, it } from 'vitest';
import { FORMAT_PRESETS, orientationOf, presetPx, pxToUnit, unitToPx } from '../src/engine/design/pageUnits';

describe('page units and presets', () => {
  it('px/in/mm conversions round-trip at common dpi', () => {
    for (const dpi of [96, 300]) for (const px of [100, 1080, 2480, 3840]) {
      expect(unitToPx(pxToUnit(px, 'in', dpi) , 'in', dpi)).toBeCloseTo(px, -1);
      expect(Math.abs(unitToPx(pxToUnit(px, 'mm', dpi), 'mm', dpi) - px)).toBeLessThanOrEqual(Math.ceil(dpi / 254) + 1);
      expect(unitToPx(pxToUnit(px, 'px', dpi), 'px', dpi)).toBe(px);
    }
    expect(unitToPx(1, 'in', 96)).toBe(96);
    expect(unitToPx(25.4, 'mm', 300)).toBe(300);
  });
  it('presets fill sizes (paper from the dpi, screen in px)', () => {
    const get = (id: string) => FORMAT_PRESETS.find((p) => p.id === id)!;
    expect(presetPx(get('story'), 96)).toEqual({ w: 1080, h: 1920 });
    expect(presetPx(get('4k'), 300)).toEqual({ w: 3840, h: 2160 });
    expect(presetPx(get('a4'), 300)).toEqual({ w: 2480, h: 3508 });
  });
  it('orientation follows the larger side', () => {
    expect(orientationOf(1920, 1080)).toBe('landscape');
    expect(orientationOf(1080, 1920)).toBe('portrait');
    expect(orientationOf(1000, 1000)).toBe('portrait');
  });
});
