import type { BrushOptions } from './brushEngine';

/** Pencil presets: they only fill ui.brush (never the color); saved strokes carry the resulting tip, so they look the same. */
export type PresetValues = Required<Pick<BrushOptions, 'size' | 'hardness' | 'minSize' | 'minDensity' | 'pressureSize' | 'pressureDensity' | 'simulatePressure' | 'pressureSpeed' | 'taperStart' | 'taperEnd' | 'texture' | 'textureStrength' | 'tooth' | 'edge' | 'roundness' | 'angle' | 'follow' | 'blend' | 'keepOpacity'>> & Pick<BrushOptions, 'leadHardness' | 'dabs' | 'dabSpacing' | 'dabScatter' | 'dabSizeJitter' | 'dabAngleJitter' | 'dabFlow'> & { opacity: number; smoothing: number; stabilization: number };
export interface BrushPreset { id: string; label: string; values: PresetValues }

const P = (id: string, label: string, size: number, hardness: number, minSize: number, minDensity: number, texture: 'paper' | 'grain' | 'graphite', textureStrength: number, edge: number, roundness: number, angle: number, follow: boolean, blend: 'normal' | 'multiply', opacity: number, stabilization: number, smoothing: number, taperStart: number, taperEnd: number, leadHardness?: number): BrushPreset => ({
  id, label, values: { size, hardness, minSize, minDensity, pressureSize: true, pressureDensity: true, simulatePressure: false, pressureSpeed: 1, taperStart, taperEnd, texture, textureStrength, tooth: true, edge, roundness, angle, follow, blend, keepOpacity: false, opacity, smoothing, stabilization, ...(leadHardness === undefined ? {} : { leadHardness }) },
});

export const PENCIL_PRESETS: BrushPreset[] = [
  P('pencil-2h', 'Pencil 2H', 3, 1, 0.35, 0.3, 'graphite', 0.25, 0.15, 1, 0, false, 'normal', 0.65, 3, 3, 4, 6, 0.34),
  P('pencil-hb', 'Pencil HB', 5, 0.85, 0.25, 0.3, 'graphite', 0.35, 0.25, 1, 0, false, 'normal', 0.85, 4, 3, 6, 10, 0.26),
  P('pencil-4b', 'Pencil 4B', 24, 0.55, 0.4, 0.3, 'graphite', 0.6, 0.4, 0.8, 0, false, 'multiply', 0.8, 1, 1, 0, 0, 0.15),
  P('pencil-soft', 'Soft pencil', 14, 0.25, 0.3, 0.15, 'paper', 0.5, 0.35, 1, 0, false, 'multiply', 0.55, 1, 2, 0, 0),
  P('pencil-tilted', 'Tilted pencil', 44, 0.4, 0.5, 0.25, 'paper', 0.7, 0.45, 0.28, -35, false, 'multiply', 0.5, 0, 1, 0, 0),
  P('pencil-shade', 'Quick shade', 60, 0.5, 0.6, 0.2, 'paper', 0.65, 0.4, 0.4, -30, false, 'multiply', 0.35, 0, 0, 0, 0),
  P('pencil-mech', 'Mechanical 0.5', 2, 1, 0.6, 0.55, 'graphite', 0.15, 0.15, 1, 0, false, 'normal', 0.9, 4, 4, 0, 3),
  P('graphite-stick', 'Graphite stick', 36, 0.7, 0.5, 0.3, 'graphite', 0.45, 0.5, 0.25, 0, true, 'multiply', 0.65, 1, 1, 0, 0),
];

/** MyPaint-inspired dab brushes (deevad 2B / 4H pencils, tanda acrylic-04), their values taken to our scales. */
const D = (id: string, label: string, v: Omit<PresetValues, 'pressureSize' | 'pressureDensity' | 'simulatePressure' | 'pressureSpeed' | 'tooth' | 'blend' | 'keepOpacity' | 'follow' | 'smoothing' | 'stabilization' | 'taperStart' | 'taperEnd'> & { follow?: boolean }): BrushPreset => ({
  id, label, values: { ...v, pressureSize: true, pressureDensity: true, simulatePressure: false, pressureSpeed: 1, taperStart: 0, taperEnd: 0, tooth: false, follow: v.follow ?? false, blend: 'normal', keepOpacity: false, smoothing: 1, stabilization: 1, dabs: true },
});
export const DAB_PRESETS: BrushPreset[] = [
  // 2B: dabs 4 per radius, scatter 0.5 of the radius, hardness .2, light build-up (opaque .15).
  D('dabs-2b', '2B dabs', { size: 6, hardness: 0.2, minSize: 0.35, minDensity: 0.3, texture: 'graphite', textureStrength: 0.3, edge: 0, roundness: 1, angle: 0, opacity: 1, dabSpacing: 0.25, dabScatter: 0.5, dabSizeJitter: 0, dabAngleJitter: 0, dabFlow: 0.15 }),
  // 4H: the same with opaque .026: each dab adds under 1/255 at its rim, so only the Float32 plane keeps it.
  D('dabs-4h', '4H dabs', { size: 4, hardness: 0.2, minSize: 0.35, minDensity: 0.3, texture: 'graphite', textureStrength: 0.3, edge: 0, roundness: 1, angle: 0, opacity: 1, dabSpacing: 0.25, dabScatter: 0.5, dabSizeJitter: 0, dabAngleJitter: 0, dabFlow: 0.026 }),
  // Acrylic: dense hard dabs (8 per radius), a flat 4:1 tip at random angles, size varying.
  D('dabs-acrylic', 'Acrylic', { size: 30, hardness: 1, minSize: 0.3, minDensity: 0.5, texture: 'none', textureStrength: 0, edge: 0, roundness: 0.25, angle: 0, opacity: 1, dabSpacing: 0.125, dabScatter: 0.1, dabSizeJitter: 0.2, dabAngleJitter: 1, dabFlow: 0.5 }),
];

/** The brush with the preset's values; color (and anything not in the preset, like mirror) stays. */
export function applyBrushPreset<B extends object>(brush: B, preset: BrushPreset): B & PresetValues {
  // A plain preset switches dab mode off; a dab preset brings its own.
  return { ...brush, dabs: false, leadHardness: undefined, ...preset.values };
}

/** The preset whose values all still match the brush, if any. */
export function activePreset(brush: Partial<PresetValues>): BrushPreset | undefined {
  return [...PENCIL_PRESETS, ...DAB_PRESETS].find((p) => !!brush.dabs === !!p.values.dabs && (Object.keys(p.values) as Array<keyof PresetValues>).every((k) => (brush[k] ?? (k === 'keepOpacity' || k === 'follow' || k === 'tooth' ? false : k === 'edge' ? 0 : undefined)) === p.values[k]) && brush.leadHardness === p.values.leadHardness);
}
