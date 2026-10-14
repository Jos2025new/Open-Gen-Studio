import { toneTable } from './defs';

/*
 * One 256-entry lookup table per channel for Levels and Curves: the 33-point monotone tone curve of toneTable, read
 * at every 8-bit input by linear interpolation. This is exactly what a browser does with a 33-value
 * feComponentTransfer table, so the SVG path (editor and export alike) can carry the table as 256 values and map each
 * 8-bit input to its own entry: no interpolation left to the renderer.
 */
export const LUT_SIZE = 256;

export function toneLut(op: Parameters<typeof toneTable>[0]): number[] {
  const t = toneTable(op), last = t.length - 1;
  return Array.from({ length: LUT_SIZE }, (_, v) => {
    const x = (v / (LUT_SIZE - 1)) * last;
    const i = Math.min(last - 1, Math.floor(x));
    return t[i] + (t[i + 1] - t[i]) * (x - i);
  });
}
