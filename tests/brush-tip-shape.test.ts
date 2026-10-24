import { describe, expect, it } from 'vitest';
import { profile, stampSegment, textureAt, tipFor, type AlphaImage, type BrushTip } from '../src/engine/design/brushEngine';
import { tipFrame, toTipFrame, wrapAngle } from '../src/engine/design/brushTipShape';

/* Brush Tip Shape: Angle and Roundness (GIMP's ellipse maths, brushTipShape.ts). Round must stay what it was. */
const img = (w: number, h: number): AlphaImage => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
const alpha = (i: AlphaImage, x: number, y: number) => i.data[(y * i.width + x) * 4 + 3];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** stampSegment exactly as it was before the tip shape existed (copied from 01cfe73), the reference for "pixel-identical". */
function stampBefore(im: AlphaImage, ox: number, oy: number, seg: readonly number[], density: number, tip: BrushTip, rgb: [number, number, number], from?: { width: number; density: number }): void {
  const [ax, ay, bx, by, width] = seg;
  const w0 = from?.width ?? width, d0 = clamp01(from?.density ?? density), d1 = clamp01(density);
  const r = Math.max(0.5, Math.max(w0, width) / 2), dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1 - ox)), y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1 - oy));
  const x1 = Math.min(im.width, Math.ceil(Math.max(ax, bx) + r + 1 - ox)), y1 = Math.min(im.height, Math.ceil(Math.max(ay, by) + r + 1 - oy));
  const strength = clamp01(tip.textureStrength ?? 0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const px = x + ox + 0.5, py = y + oy + 0.5;
    const t = len2 ? clamp01(((px - ax) * dx + (py - ay) * dy) / len2) : 0;
    const d = Math.hypot(px - ax - t * dx, py - ay - t * dy), rt = Math.max(0.5, (w0 + (width - w0) * t) / 2);
    if (d > rt + 0.5) continue;
    let cov = profile(d, rt, tip.hardness) * (d0 + (d1 - d0) * t);
    if (tip.texture && strength) cov *= 1 - strength * (1 - textureAt(tip.texture, x + ox, y + oy));
    const a = Math.round(cov * 255), i = (y * im.width + x) * 4;
    if (a > im.data[i + 3]) { im.data[i] = rgb[0]; im.data[i + 1] = rgb[1]; im.data[i + 2] = rgb[2]; im.data[i + 3] = a; }
  }
}

const SEGS: Array<[number, number, number, number, number]> = [[10, 10, 50, 20, 14], [50, 20, 70, 60, 9.5], [70, 60, 20, 70, 22], [20, 70, 20, 70, 6]];
const run = (fn: typeof stampSegment, tip: BrushTip) => {
  const i = img(90, 90);
  SEGS.forEach((s, k) => fn(i, 3, -2, s, 0.8, tip, [10, 20, 30], k ? { width: SEGS[k - 1][4], density: 0.6 } : undefined));
  return i.data;
};

describe('round tip is pixel-identical to before', () => {
  const tips: BrushTip[] = [{ hardness: 1 }, { hardness: 0.4 }, { hardness: 0.7, texture: 'paper', textureStrength: 0.6 },
    tipFor({ size: 10, roundness: 1, angle: 45, follow: true }, false), tipFor({ size: 10, angle: 90 }, false)];
  tips.forEach((tip, n) => it(`tip ${n}`, () => { expect(Array.from(run(stampSegment, tip))).toEqual(Array.from(run(stampBefore, tip))); }));
  it('a round tip records no new field, so saved strokes and settings stay as they were', () => {
    expect(tipFor({ size: 10, roundness: 1, angle: 30, follow: true }, false)).toEqual({ hardness: 1 });
    expect(tipFor({ size: 10 }, true)).toEqual({ hardness: 1 });
  });
});

describe('elliptical tip', () => {
  const dab = (tip: BrushTip, w = 40) => { const i = img(60, 60); stampSegment(i, 0, 0, [30, 30, 30, 30, w], 1, tip, [0, 0, 0]); return i; };
  const covered = (i: AlphaImage, x: number, y: number) => alpha(i, x, y) > 128;
  it('roundness 0.5 at angle 0: full width along x, half along y (GIMP short_radius = radius / aspect_ratio)', () => {
    const i = dab({ hardness: 1, roundness: 0.5 });
    expect(covered(i, 48, 30)).toBe(true); expect(covered(i, 51, 30)).toBe(false);
    expect(covered(i, 30, 39)).toBe(true); expect(covered(i, 30, 42)).toBe(false);
  });
  it('angle 90 swaps the axes; a positive angle turns the long axis counter-clockwise on screen', () => {
    const i = dab({ hardness: 1, roundness: 0.5, angle: 90 });
    expect(covered(i, 30, 11)).toBe(true); expect(covered(i, 30, 8)).toBe(false);
    expect(covered(i, 39, 30)).toBe(true); expect(covered(i, 42, 30)).toBe(false);
    const j = dab({ hardness: 1, roundness: 0.2, angle: 45 });
    expect(covered(j, 43, 17)).toBe(true);   // up and to the right
    expect(covered(j, 43, 43)).toBe(false);
  });
  it('area is roundness times the circle', () => {
    const sum = (i: AlphaImage) => { let n = 0; for (let k = 3; k < i.data.length; k += 4) n += i.data[k] / 255; return n; };
    expect(sum(dab({ hardness: 1, roundness: 0.5, angle: 33 })) / sum(dab({ hardness: 1 }))).toBeCloseTo(0.5, 1);
  });
  it('follow stroke: the long axis lies along the stroke, whatever its direction', () => {
    const f = tipFrame({ roundness: 0.5, follow: true }, 0, 5)!;     // a stroke straight down the screen
    const [along, across] = toTipFrame(f, 0, 10), [along2, across2] = toTipFrame(f, 10, 0);
    expect(Math.abs(along)).toBeCloseTo(10); expect(Math.abs(across)).toBeCloseTo(0);
    expect(Math.abs(along2)).toBeCloseTo(0); expect(Math.abs(across2)).toBeCloseTo(20);
    expect(tipFrame({ roundness: 1, follow: true }, 3, 4)).toBeNull();
  });
  it('tipFor records the shape only when squeezed, clamps and wraps', () => {
    expect(tipFor({ size: 10, roundness: 0.5, angle: 190, follow: true }, false)).toEqual({ hardness: 1, roundness: 0.5, angle: -170, follow: true });
    expect(tipFor({ size: 10, roundness: 0 }, true)).toEqual({ hardness: 1, roundness: 0.01 });
    expect(wrapAngle(540)).toBe(180); expect(wrapAngle(-181)).toBe(179);
  });
});
