import type { DesignDoc, Layer } from '../types';

export const PRINT_PPI = 300;

/**
 * Print preflight: the resolution each raster layer gets at the printed size. Never resampled; a low value is only
 * reported. `printedPxPerDocPx` is how many 96-dpi px of the printed page one document px takes.
 */
export function printPreflight(doc: DesignDoc, printedPxPerDocPx: number, size: (layer: Extract<Layer, { type: 'raster' }>) => { w: number; h: number } | null, target = PRINT_PPI): string[] {
  const out: string[] = [];
  for (const l of doc.layers) {
    if (l.type !== 'raster' || !l.visible) continue;
    const source = size(l);
    const stretch = l.transform ? Math.hypot(l.transform[0], l.transform[1]) || 1 : 1;
    const inches = (l.width * stretch * printedPxPerDocPx) / 96;
    if (!source || inches <= 0) continue;
    const ppi = Math.round(source.w / inches);
    if (ppi < target) out.push(`“${l.name}” will print at ${ppi} ppi (${target} recommended).`);
  }
  return out;
}

/** Canvas px per SVG px for raster made at print resolution; `layoutScale` is printed px per SVG px. Never below 1. */
export const printPixelRatio = (layoutScale: number, ppi = PRINT_PPI) => Math.max(1, (ppi / 96) * layoutScale);
