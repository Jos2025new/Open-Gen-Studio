/** Page units and format presets for the Sizes card. The document always stays in px; units only change what the fields show. */
export type PageUnit = 'px' | 'mm' | 'in';
export const PAGE_UNITS: PageUnit[] = ['px', 'mm', 'in'];
export const DEFAULT_DPI = 96;
const MM_PER_IN = 25.4;

/** Px to the shown unit (mm and in at `dpi`), rounded for display (px whole, mm 0.1, in 0.01). */
export function pxToUnit(px: number, unit: PageUnit, dpi: number): number {
  if (unit === 'px') return Math.round(px);
  const inches = px / dpi;
  return unit === 'in' ? Math.round(inches * 100) / 100 : Math.round(inches * MM_PER_IN * 10) / 10;
}

/** A value typed in the shown unit back to whole px (at least 1). */
export function unitToPx(v: number, unit: PageUnit, dpi: number): number {
  const px = unit === 'px' ? v : unit === 'in' ? v * dpi : (v / MM_PER_IN) * dpi;
  return Math.max(1, Math.round(px));
}

export interface FormatPreset { id: string; label: string; /** Size in px, or in mm when `mm` is set (paper). */ w: number; h: number; mm?: boolean }
export const FORMAT_PRESETS: FormatPreset[] = [
  { id: 'a4', label: 'A4', w: 210, h: 297, mm: true },
  { id: 'a5', label: 'A5', w: 148, h: 210, mm: true },
  { id: 'letter', label: 'Letter', w: 215.9, h: 279.4, mm: true },
  { id: 'square', label: 'Square 1080×1080', w: 1080, h: 1080 },
  { id: 'story', label: 'Story 1080×1920', w: 1080, h: 1920 },
  { id: 'hd', label: 'HD 1920×1080', w: 1920, h: 1080 },
  { id: '4k', label: '4K 3840×2160', w: 3840, h: 2160 },
];

/** Px size of a preset (portrait for paper); paper uses the current dpi. */
export function presetPx(p: FormatPreset, dpi: number): { w: number; h: number } {
  return p.mm ? { w: unitToPx(p.w, 'mm', dpi), h: unitToPx(p.h, 'mm', dpi) } : { w: p.w, h: p.h };
}

export type Orientation = 'portrait' | 'landscape';
export const orientationOf = (w: number, h: number): Orientation => (w > h ? 'landscape' : 'portrait');
