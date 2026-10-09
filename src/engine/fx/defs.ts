import type { FxGroup, FxKind, FxOp, FxValue } from './types';

/* The FX registry: every filter and effect, once. Ranges clamp what the UI, nodes and the agent send. */

export type FxParam =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number; unit?: string }
  | { key: string; label: string; type: 'color'; default: string };

export interface FxDef {
  kind: FxKind;
  group: FxGroup;
  label: string;
  description: string;
  params: FxParam[];
  /** The one value the asset/node form shows. */
  primary: string;
  /** Exported as an SVG filter primitive; false = left out of SVG, with a notice. */
  svg: boolean;
}

const num = (key: string, label: string, min: number, max: number, step: number, value: number, unit?: string): FxParam => ({ key, label, type: 'number', min, max, step, default: value, unit });
const color = (key: string, label: string, value: string): FxParam => ({ key, label, type: 'color', default: value });
const def = (kind: FxKind, group: FxGroup, label: string, description: string, params: FxParam[], svg = true): FxDef => ({ kind, group, label, description, params, primary: params[0].key, svg });

export const FX_DEFS: Record<FxKind, FxDef> = {
  brightness: def('brightness', 'filter', 'Brightness', 'Lighten or darken; 1 keeps it as is.', [num('amount', 'Amount', 0, 3, 0.05, 1.2)]),
  contrast: def('contrast', 'filter', 'Contrast', 'More or less contrast; 1 keeps it as is.', [num('amount', 'Amount', 0, 3, 0.05, 1.3)]),
  saturation: def('saturation', 'filter', 'Saturation', 'More or less colour; 0 is grey, 1 keeps it as is.', [num('amount', 'Amount', 0, 3, 0.05, 1.5)]),
  hue: def('hue', 'filter', 'Hue', 'Rotate every colour around the colour wheel.', [num('degrees', 'Degrees', -180, 180, 1, 30, '°')]),
  grayscale: def('grayscale', 'filter', 'Grayscale', 'Remove colour; 1 is fully grey.', [num('amount', 'Amount', 0, 1, 0.05, 1)]),
  sepia: def('sepia', 'filter', 'Sepia', 'Warm brown tone of old photos.', [num('amount', 'Amount', 0, 1, 0.05, 1)]),
  invert: def('invert', 'filter', 'Invert', 'Negative colours; 1 fully inverted.', [num('amount', 'Amount', 0, 1, 0.05, 1)]),
  blur: def('blur', 'filter', 'Blur', 'Soften with a Gaussian blur.', [num('radius', 'Radius', 0, 100, 0.5, 4, 'px')]),
  glow: def('glow', 'effect', 'Glow', 'A soft halo of the content’s own light.', [num('strength', 'Strength', 0, 2, 0.05, 0.8), num('radius', 'Radius', 1, 100, 1, 12, 'px')]),
  shadow: def('shadow', 'effect', 'Drop shadow', 'A shadow behind the content.', [num('blur', 'Blur', 0, 100, 1, 12, 'px'), num('x', 'Offset x', -200, 200, 1, 8, 'px'), num('y', 'Offset y', -200, 200, 1, 8, 'px'), color('color', 'Color', '#000000'), num('opacity', 'Opacity', 0, 1, 0.05, 0.6)]),
  flare: def('flare', 'effect', 'Lens flare', 'A bright light with rings and ghosts toward the centre; placed within the layer it acts on (or the page).', [num('intensity', 'Intensity', 0, 2, 0.05, 1), num('x', 'Position x', 0, 1, 0.01, 0.75), num('y', 'Position y', 0, 1, 0.01, 0.25), num('size', 'Size', 0.05, 1, 0.01, 0.3), color('color', 'Color', '#ffd9a0')], false),
};

export const FX_KINDS = Object.keys(FX_DEFS) as FxKind[];
export const fxKindsOf = (group: FxGroup) => FX_KINDS.filter((k) => FX_DEFS[k].group === group);
export const isFxKind = (v: unknown): v is FxKind => typeof v === 'string' && v in FX_DEFS;

const HEX = /^#[0-9a-f]{6}$/i;

/** Every param of the kind, from defaults, with what was given clamped to its range (unknown keys dropped). */
export function fxParams(kind: FxKind, given: Record<string, unknown> = {}): Record<string, FxValue> {
  return Object.fromEntries(FX_DEFS[kind].params.map((p) => {
    const v = given[p.key];
    if (p.type === 'color') return [p.key, typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : p.default];
    const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return [p.key, Number.isFinite(x) ? Math.min(p.max, Math.max(p.min, x)) : p.default];
  }));
}

export const numParam = (op: Pick<FxOp, 'params'>, key: string): number => Number(op.params[key]) || 0;

/** "#rrggbb" + alpha → rgba() for canvas. */
export function rgba(hex: string, alpha: number): string {
  const h = HEX.test(hex) ? hex : '#000000';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000})`;
}
