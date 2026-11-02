import type { BrushOptions } from './brushEngine';

/** Pencil presets: they only fill ui.brush (never the color); saved strokes carry the resulting tip, so they look the same. */
export type PresetValues = Required<Pick<BrushOptions, 'size' | 'hardness' | 'minSize' | 'minDensity' | 'pressureSize' | 'pressureDensity' | 'simulatePressure' | 'pressureSpeed' | 'taperStart' | 'taperEnd' | 'texture' | 'textureStrength' | 'tooth' | 'edge' | 'roundness' | 'angle' | 'follow' | 'blend' | 'keepOpacity'>> & { opacity: number; smoothing: number; stabilization: number };
export interface BrushPreset { id: string; label: string; values: PresetValues }

const P = (id: string, label: string, size: number, hardness: number, minSize: number, minDensity: number, texture: 'paper' | 'grain' | 'graphite', textureStrength: number, edge: number, roundness: number, angle: number, follow: boolean, blend: 'normal' | 'multiply', opacity: number, stabilization: number, smoothing: number, taperStart: number, taperEnd: number): BrushPreset => ({
  id, label, values: { size, hardness, minSize, minDensity, pressureSize: true, pressureDensity: true, simulatePressure: false, pressureSpeed: 1, taperStart, taperEnd, texture, textureStrength, tooth: true, edge, roundness, angle, follow, blend, keepOpacity: false, opacity, smoothing, stabilization },
});

export const PENCIL_PRESETS: BrushPreset[] = [
  P('pencil-2h', 'Pencil 2H', 3, 1, 0.35, 0.3, 'graphite', 0.25, 0.15, 1, 0, false, 'normal', 0.65, 3, 3, 4, 6),
  P('pencil-hb', 'Pencil HB', 5, 0.85, 0.25, 0.35, 'graphite', 0.35, 0.25, 1, 0, false, 'normal', 0.85, 4, 3, 6, 10),
  P('pencil-4b', 'Pencil 4B', 24, 0.55, 0.4, 0.25, 'graphite', 0.6, 0.4, 0.8, 0, false, 'multiply', 0.8, 1, 1, 0, 0),
  P('pencil-soft', 'Soft pencil', 14, 0.25, 0.3, 0.15, 'paper', 0.5, 0.35, 1, 0, false, 'multiply', 0.55, 1, 2, 0, 0),
  P('pencil-tilted', 'Tilted pencil', 44, 0.4, 0.5, 0.25, 'paper', 0.7, 0.45, 0.28, -35, false, 'multiply', 0.5, 0, 1, 0, 0),
  P('pencil-shade', 'Quick shade', 60, 0.5, 0.6, 0.2, 'paper', 0.65, 0.4, 0.4, -30, false, 'multiply', 0.35, 0, 0, 0, 0),
  P('pencil-mech', 'Mechanical 0.5', 2, 1, 0.6, 0.55, 'graphite', 0.15, 0.15, 1, 0, false, 'normal', 0.9, 4, 4, 0, 3),
  P('graphite-stick', 'Graphite stick', 36, 0.7, 0.5, 0.3, 'graphite', 0.45, 0.5, 0.25, 0, true, 'multiply', 0.65, 1, 1, 0, 0),
];

/** The brush with the preset's values; color (and anything not in the preset, like mirror) stays. */
export function applyBrushPreset<B extends object>(brush: B, preset: BrushPreset): B & PresetValues {
  return { ...brush, ...preset.values };
}

/** The preset whose values all still match the brush, if any. */
export function activePreset(brush: Partial<PresetValues>): BrushPreset | undefined {
  return PENCIL_PRESETS.find((p) => (Object.keys(p.values) as Array<keyof PresetValues>).every((k) => (brush[k] ?? (k === 'keepOpacity' || k === 'follow' || k === 'tooth' ? false : k === 'edge' ? 0 : undefined)) === p.values[k]));
}
