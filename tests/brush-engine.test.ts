import { describe, expect, it } from 'vitest';
import { atPressure, BRUSH_DEFAULTS, compositeOp, profile, stampSegment, textureAt, tipFor, type AlphaImage, type BrushTip } from '../src/engine/design/brushEngine';

/*
 * The raster brush tip (after PaintTool SAI): hardness, pressure on size and density, texture, blend and Keep
 * Opacity. The same engine paints the live stroke, replays the saved one and draws the settings preview.
 */
const img = (w: number, h: number): AlphaImage => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
const alpha = (i: AlphaImage, x: number, y: number) => i.data[(y * i.width + x) * 4 + 3];

describe('pressure', () => {
  it('a full-pressure stroke is the brush size and full density; min size and min density set the light end', () => {
    expect(atPressure({ size: 20 }, 0.2)).toEqual({ width: 20, density: 1 });
    expect(atPressure({ size: 20, minSize: 0.25 }, 0)).toMatchObject({ width: 5 });
    expect(atPressure({ size: 20, minSize: 0.25 }, 1)).toMatchObject({ width: 20 });
    expect(atPressure({ size: 20, minSize: 0.25, pressureSize: false }, 0)).toMatchObject({ width: 20 });
    expect(atPressure({ size: 20, pressureDensity: true }, 0).density).toBe(BRUSH_DEFAULTS.minDensity);
    expect(atPressure({ size: 20, pressureDensity: true, minDensity: 0.5 }, 0.5).density).toBe(0.75);
  });
});

describe('the tip a stroke records', () => {
  it('every new stroke records its tip, the plain hard one too, so it replays through the same engine', () => {
    expect(tipFor({ size: 10 }, false)).toEqual({ hardness: 1 });
    expect(tipFor({ size: 10, minSize: 0.2 }, false)).toEqual({ hardness: 1 });
  });
  it('hardness, texture, blend, Keep Opacity and pressure density are recorded; the eraser ignores blend and Keep Opacity', () => {
    expect(tipFor({ size: 10, hardness: 0.4, texture: 'paper', textureStrength: 0.6, blend: 'multiply', keepOpacity: true, pressureDensity: true }, false))
      .toEqual({ hardness: 0.4, texture: 'paper', textureStrength: 0.6, blend: 'multiply', keepOpacity: true, densities: [] });
    expect(tipFor({ size: 10, hardness: 0.4, blend: 'multiply', keepOpacity: true }, true)).toEqual({ hardness: 0.4 });
    expect(tipFor({ size: 10, texture: 'paper', textureStrength: 0 }, false)).toEqual({ hardness: 1 });
  });
  it('lays the mask with the stroke blend, or removes with the eraser', () => {
    expect(compositeOp(undefined, false)).toBe('source-over');
    expect(compositeOp({ hardness: 1, blend: 'multiply' }, false)).toBe('multiply');
    expect(compositeOp({ hardness: 1, blend: 'multiply' }, true)).toBe('destination-out');
  });
});

describe('the profile (what the tip icons draw)', () => {
  it('hard: full inside, a one-pixel anti-aliased rim; soft: falls off from the core to the rim', () => {
    expect(profile(0, 10, 1)).toBe(1);
    expect(profile(10, 10, 1)).toBe(0.5);
    expect(profile(11, 10, 1)).toBe(0);
    expect(profile(3, 10, 0.4)).toBe(1);
    const mid = profile(7, 10, 0.4);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(profile(7, 10, 0.05)).toBeLessThan(profile(7, 10, 0.4));
  });
});

describe('stamping', () => {
  const tip: BrushTip = { hardness: 1 };
  it('a segment covers its width, leaves the rest empty, and writes the colour', () => {
    const i = img(40, 20);
    stampSegment(i, 0, 0, [5, 10, 35, 10, 8], 1, tip, [255, 0, 0]);
    expect(alpha(i, 20, 10)).toBe(255);
    expect(alpha(i, 20, 13)).toBe(255);
    expect(alpha(i, 20, 16)).toBe(0);
    expect([...i.data.slice((10 * 40 + 20) * 4, (10 * 40 + 20) * 4 + 3)]).toEqual([255, 0, 0]);
  });
  it('overlapping segments keep the strongest coverage instead of adding up (no beads at the joints)', () => {
    const once = img(40, 20), twice = img(40, 20), soft: BrushTip = { hardness: 0.2 };
    stampSegment(once, 0, 0, [10, 10, 20, 10, 12], 0.5, soft, [0, 0, 0]);
    stampSegment(twice, 0, 0, [10, 10, 20, 10, 12], 0.5, soft, [0, 0, 0]);
    stampSegment(twice, 0, 0, [10, 10, 20, 10, 12], 0.5, soft, [0, 0, 0]);
    expect(twice.data).toEqual(once.data);
    expect(alpha(once, 15, 10)).toBe(128);
  });
  it('a soft tip fades toward its rim; density scales it; a mask offset maps layer pixels', () => {
    const i = img(40, 40);
    stampSegment(i, 100, 100, [120, 120, 120, 120, 30], 1, { hardness: 0.1 }, [0, 0, 0]);
    expect(alpha(i, 20, 20)).toBe(255);
    expect(alpha(i, 30, 20)).toBeGreaterThan(0);
    expect(alpha(i, 30, 20)).toBeLessThan(alpha(i, 25, 20));
  });
  it('texture takes paint away by its strength, the same at the same pixel every time (live and replay match)', () => {
    const plain = img(30, 30), textured = img(30, 30), again = img(30, 30);
    const paper: BrushTip = { hardness: 1, texture: 'paper', textureStrength: 0.8 };
    stampSegment(plain, 0, 0, [5, 15, 25, 15, 20], 1, tip, [0, 0, 0]);
    stampSegment(textured, 0, 0, [5, 15, 25, 15, 20], 1, paper, [0, 0, 0]);
    stampSegment(again, 0, 0, [5, 15, 25, 15, 20], 1, paper, [0, 0, 0]);
    const sum = (i: AlphaImage) => i.data.filter((_, k) => k % 4 === 3).reduce((a, b) => a + b, 0);
    expect(sum(textured)).toBeLessThan(sum(plain) * 0.85);
    expect(again.data).toEqual(textured.data);
    for (const kind of ['paper', 'canvas', 'grain'] as const) for (let k = 0; k < 50; k++) {
      const v = textureAt(kind, k * 7, k * 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
