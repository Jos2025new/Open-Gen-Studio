import type { BlendMode } from '../types';

/*
 * The raster brush tip, as PaintTool SAI shapes it: a hardness profile, pressure on size and density, paper texture,
 * a blend mode and Keep Opacity. One engine draws the stroke being painted, a saved stroke replayed (undo, reload,
 * moving objects) and the preview in the settings, so all three look the same.
 *
 * The stroke is laid into an alpha mask where every pixel keeps the strongest coverage it got (max, never a sum):
 * overlapping segments cannot add up into beads, at any hardness or density. The mask is then composited once.
 * Every new stroke records its tip, so it replays exactly as it was painted. Strokes saved before this engine have
 * no tip and keep the canvas line renderer they were painted with (raster.ts), so old documents look the same.
 */

export type BrushTexture = 'none' | 'paper' | 'canvas' | 'grain';
export type BrushBlend = Extract<BlendMode, 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'>;

/** What a saved stroke needs to be drawn again; absent = a stroke from before this engine. */
export interface BrushTip {
  /** 1 = hard edge; lower = a soft falloff from the core to the rim. */
  hardness: number;
  texture?: BrushTexture;
  /** How much the texture takes away (0–1). */
  textureStrength?: number;
  blend?: BrushBlend;
  /** Paint only where the layer already has pixels (SAI's Keep Opacity). */
  keepOpacity?: boolean;
  /** Density of each segment (pressure), parallel to the stroke's segments; absent = full. */
  densities?: number[];
  /** Painted with mirror: segments come in pairs, each followed by its reflection across the page's centre. */
  mirror?: boolean;
}

/** The brush settings the tip comes from (ui.brush). */
export interface BrushOptions {
  size: number;
  hardness?: number;
  minSize?: number;
  minDensity?: number;
  pressureSize?: boolean;
  /** Pressure from the pointer's speed, as Lineart does it (perfect-freehand): fast is light, slow is full. */
  simulatePressure?: boolean;
  /** How much speed thins a simulated-pressure stroke: 1 = as Lineart, 2 = twice as much, 0.25 = barely. */
  pressureSpeed?: number;
  pressureDensity?: boolean;
  /** Paint a reflection of every stroke across the page's vertical centre line. */
  mirror?: boolean;
  /** Distance (px, as the size) over which the stroke grows from a point at its start / shrinks to one at its end. */
  taperStart?: number;
  taperEnd?: number;
  texture?: BrushTexture;
  textureStrength?: number;
  blend?: BrushBlend;
  keepOpacity?: boolean;
}

export const BRUSH_BLENDS: BrushBlend[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];
export const BRUSH_TEXTURES: Array<{ value: BrushTexture; label: string }> = [
  { value: 'none', label: 'None' }, { value: 'paper', label: 'Paper' }, { value: 'canvas', label: 'Canvas' }, { value: 'grain', label: 'Grain' },
];
/** The four tip profiles of SAI's tip row, hard to soft. */
export const TIP_PRESETS = [1, 0.7, 0.4, 0.05];
/** Values a brush has before the user sets them (the settings show the same ones). */
// minSize below 1 so "Pressure → size" does something as soon as it is on (SAI starts near 15 %).
export const BRUSH_DEFAULTS = { hardness: 1, minSize: 0.2, minDensity: 0.2, textureStrength: 0.5 };
/** One-click sizes, as SAI's size grid. */
export const SIZE_PRESETS = [1, 2, 3, 5, 8, 12, 16, 24, 32, 48, 64, 96, 128, 200];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Width and density at a pressure (0–1): the minimum share at no pressure, all of it at full pressure. */
export function atPressure(o: BrushOptions, pressure: number): { width: number; density: number } {
  const p = clamp01(pressure);
  const minSize = clamp01(o.minSize ?? BRUSH_DEFAULTS.minSize), minDensity = clamp01(o.minDensity ?? BRUSH_DEFAULTS.minDensity);
  return {
    width: o.pressureSize === false ? o.size : o.size * (minSize + (1 - minSize) * p),
    density: o.pressureDensity ? minDensity + (1 - minDensity) * p : 1,
  };
}

/** One 60 Hz event: the step the original formula was tuned for. */
const FRAME_MS = 1000 / 60;

/**
 * The simulated pressure after a move of `distance`, from the previous one: perfect-freehand's own formula (the one
 * Lineart strokes use), so both tools respond to speed the same way. With `ms` (the time the move took) it follows
 * the speed, not the event rate: the move counts as `ms / 16.7` steps of 60 Hz at the same speed, so a 60, 120 or
 * 240 Hz pointer gives the same pressure, and at 60 Hz the values are the formula's own. `influence` scales how
 * much speed thins the stroke (1 = as Lineart).
 */
export function simulatedPressure(previous: number, distance: number, size: number, ms = FRAME_MS, influence = 1): number {
  const steps = Math.max(0.01, ms) / FRAME_MS;
  const r = Math.min(1, (influence * distance) / steps / Math.max(1e-6, size));
  return Math.min(1, previous + (Math.min(1, 1 - r) - previous) * (1 - (1 - r * 0.275) ** steps));
}

/**
 * The share of the width a taper leaves at `distance` from its end of the stroke: 0 at the end, all of it from
 * `length` on. The curves are perfect-freehand's defaults (the ones Lineart's tapers use): the start opens fast
 * (ease-out quad), the end closes late (ease-out cubic). Pressure then shapes the middle, as it already did.
 */
export function taperAt(distance: number, length: number | undefined, end: 'start' | 'end'): number {
  if (!length || length <= 0) return 1;
  const t = clamp01(distance / length);
  return end === 'start' ? t * (2 - t) : 1 - (1 - t) ** 3;
}

/** The tip a new stroke records (always: even the plain hard tip replays through this engine). */
export function tipFor(o: BrushOptions, erase: boolean): BrushTip {
  const hardness = clamp01(o.hardness ?? BRUSH_DEFAULTS.hardness);
  // A texture without a recorded strength (a preset, an older brush) gets the default, as the panel gives it.
  const strength = o.textureStrength ?? BRUSH_DEFAULTS.textureStrength;
  const texture = o.texture && o.texture !== 'none' && strength > 0 ? o.texture : undefined;
  const blend = !erase && o.blend && o.blend !== 'normal' ? o.blend : undefined;
  const keepOpacity = !erase && o.keepOpacity ? true : undefined;
  return { hardness, ...(texture ? { texture, textureStrength: clamp01(strength) } : {}), ...(blend ? { blend } : {}), ...(keepOpacity ? { keepOpacity } : {}), ...(o.pressureDensity ? { densities: [] } : {}), ...(o.mirror ? { mirror: true } : {}) };
}

/** Coverage at distance d from the centre line, for a radius and hardness (the same curve the tip icons show). */
export function profile(d: number, radius: number, hardness: number): number {
  // Anti-aliased rim: one pixel wide, like the canvas line it replaces.
  const rim = clamp01(radius + 0.5 - d);
  if (hardness >= 1 || radius <= 0.5) return rim;
  const core = radius * hardness;
  if (d <= core) return rim;
  const t = clamp01((d - core) / Math.max(1e-6, radius - core));
  return Math.min(rim, 1 - t * t * (3 - 2 * t));
}

/** A repeatable value in 0–1 for a pixel (no randomness that would differ between live and replay). */
function hash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smoothNoise(x: number, y: number, cell: number): number {
  const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** The texture's value at a layer pixel: 1 lets all the paint through, lower takes some away. */
export function textureAt(kind: BrushTexture | undefined, x: number, y: number): number {
  switch (kind) {
    case 'paper': return 0.55 * smoothNoise(x, y, 3) + 0.3 * smoothNoise(x, y, 9) + 0.15 * hash(x, y);
    case 'canvas': return 0.5 + 0.25 * Math.sin(x * 0.9) * Math.sin(y * 0.9) + 0.25 * smoothNoise(x, y, 6);
    case 'grain': return hash(x, y) < 0.35 ? 0.15 : 1;
    default: return 1;
  }
}

export interface AlphaImage { data: Uint8ClampedArray; width: number; height: number }

/**
 * Lay one segment into an RGBA mask (ox/oy: the mask's top-left in layer pixels), keeping each pixel's strongest
 * coverage. The colour is written with it, so the mask can be composited as the paint itself.
 */
export function stampSegment(img: AlphaImage, ox: number, oy: number, seg: readonly number[], density: number, tip: BrushTip, rgb: [number, number, number], from?: { width: number; density: number }): void {
  // Width and density run from the previous segment's to this one's, so pressure changes blend instead of stepping.
  const [ax, ay, bx, by, width] = seg;
  const w0 = from?.width ?? width, d0 = clamp01(from?.density ?? density), d1 = clamp01(density);
  const r = Math.max(0.5, Math.max(w0, width) / 2), dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1 - ox)), y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1 - oy));
  const x1 = Math.min(img.width, Math.ceil(Math.max(ax, bx) + r + 1 - ox)), y1 = Math.min(img.height, Math.ceil(Math.max(ay, by) + r + 1 - oy));
  const strength = clamp01(tip.textureStrength ?? 0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const px = x + ox + 0.5, py = y + oy + 0.5;
      const t = len2 ? clamp01(((px - ax) * dx + (py - ay) * dy) / len2) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy), rt = Math.max(0.5, (w0 + (width - w0) * t) / 2);
      if (d > rt + 0.5) continue;
      let cov = profile(d, rt, tip.hardness) * (d0 + (d1 - d0) * t);
      if (tip.texture && strength) cov *= 1 - strength * (1 - textureAt(tip.texture, x + ox, y + oy));
      const a = Math.round(cov * 255), i = (y * img.width + x) * 4;
      if (a > img.data[i + 3]) {
        img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = a;
      }
    }
  }
}

export function hexRgb(hex: string): [number, number, number] {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '000000';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** The box a segment touches, padded for its radius and anti-aliasing. */
export function segmentBox(seg: readonly number[]): { x: number; y: number; w: number; h: number } {
  const r = Math.max(0.5, seg[4] / 2) + 2;
  const x = Math.floor(Math.min(seg[0], seg[2]) - r), y = Math.floor(Math.min(seg[1], seg[3]) - r);
  return { x, y, w: Math.ceil(Math.max(seg[0], seg[2]) + r) - x, h: Math.ceil(Math.max(seg[1], seg[3]) + r) - y };
}

/** How the mask is laid on the layer: the stroke's blend (erase removes), then Keep Opacity. */
export function compositeOp(tip: BrushTip | undefined, erase: boolean): GlobalCompositeOperation {
  if (erase) return 'destination-out';
  const blend = tip?.blend ?? 'normal';
  return blend === 'normal' ? 'source-over' : blend;
}
