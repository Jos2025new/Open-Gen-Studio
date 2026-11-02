import { describe, expect, it } from 'vitest';
import { profile, stampSegment, textureAt, tipFor, BRUSH_TEXTURES, type AlphaImage, type BrushTip } from '../src/engine/design/brushEngine';

/* Live pencil edges: tooth (texture subtracts) and a living edge, both opt-in; tips without them replay as before. */
const img = (w: number, h: number): AlphaImage => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
const alpha = (i: AlphaImage, x: number, y: number) => i.data[(y * i.width + x) * 4 + 3];
const stamp = (tip: BrushTip, density = 1, w = 12) => {
  const i = img(80, 40);
  stampSegment(i, 0, 0, [10, 20, 70, 20, w], density, tip, [0, 0, 0]);
  return i;
};
const alphas = (i: AlphaImage) => Array.from({ length: i.width * i.height }, (_, k) => i.data[k * 4 + 3]);

describe('tips without the new fields', () => {
  it('give the mask the old formula gave (multiplicative texture, clean capsule)', () => {
    const tip: BrushTip = { hardness: 0.6, texture: 'paper', textureStrength: 0.5 };
    const got = stamp(tip, 0.8, 9);
    const want = img(80, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 80; x++) {
      const px = x + 0.5, py = y + 0.5, t = Math.min(1, Math.max(0, (px - 10) / 60));
      const d = Math.hypot(px - 10 - t * 60, py - 20), rt = 4.5;
      if (d > rt + 0.5) continue;
      const cov = profile(d, rt, 0.6) * 0.8 * (1 - 0.5 * (1 - textureAt('paper', x, y)));
      want.data[(y * 80 + x) * 4 + 3] = Math.round(cov * 255);
    }
    expect(alphas(got)).toEqual(alphas(want));
  });
  it('tipFor records nothing new unless the brush asks', () => {
    const tip = tipFor({ size: 5, texture: 'paper', textureStrength: 0.5 }, false);
    expect('tooth' in tip || 'edge' in tip).toBe(false);
    expect(tipFor({ size: 5, texture: 'paper', tooth: true, edge: 0.3 }, false)).toMatchObject({ tooth: true, edge: 0.3 });
    expect(BRUSH_TEXTURES.map((t) => t.value)).toContain('graphite');
  });
});

describe('tooth', () => {
  const holes = (i: AlphaImage) => { let n = 0; for (let y = 17; y <= 23; y++) for (let x = 20; x < 60; x++) if (alpha(i, x, y) === 0) n++; return n; };
  it('light density leaves more bare paper inside the stroke than heavy density', () => {
    const tip: BrushTip = { hardness: 1, texture: 'graphite', textureStrength: 0.6, tooth: true };
    const light = holes(stamp(tip, 0.25)), heavy = holes(stamp(tip, 1));
    expect(light).toBeGreaterThan(heavy + 20);
    expect(holes(stamp({ hardness: 1, texture: 'graphite', textureStrength: 0.6 }, 0.25))).toBe(0);
  });
  it('is deterministic', () => {
    const tip: BrushTip = { hardness: 1, texture: 'graphite', textureStrength: 0.6, tooth: true, edge: 0.4 };
    expect(alphas(stamp(tip, 0.5))).toEqual(alphas(stamp(tip, 0.5)));
  });
});

describe('living edge', () => {
  it('breaks the outline but stays within the radius plus half the edge', () => {
    const base = stamp({ hardness: 1 }), tip: BrushTip = { hardness: 1, edge: 0.5 }, live = stamp(tip);
    expect(alphas(live)).not.toEqual(alphas(base));
    const bound = 6 * (1 + 0.5 / 2) + 1;
    for (let y = 0; y < 40; y++) for (let x = 20; x < 60; x++) if (alpha(live, x, y) > 0) expect(Math.abs(y + 0.5 - 20)).toBeLessThanOrEqual(bound);
    expect(alphas(live)).toEqual(alphas(stamp(tip)));
  });
});
