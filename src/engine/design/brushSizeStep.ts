import { BRUSH_MAX_SIZE } from './brushEngine';

/** The next brush size for `[` (dir -1) and `]` (dir +1): about 7 % of the size, at least 1 px, within 1..BRUSH_MAX_SIZE. */
export function stepBrushSize(size: number, dir: 1 | -1): number {
  const step = Math.max(1, Math.round(size / 15));
  return Math.min(BRUSH_MAX_SIZE, Math.max(1, Math.round(size) + dir * step));
}

/** The Size range (×1 up to 100 px, ×10 above) a size shows in: the chosen one while it fits, else the only one that holds it. */
export const sizeRangeFor = (size: number, chosen?: 1 | 10): 1 | 10 => (size > 100 ? 10 : size < 10 ? 1 : chosen ?? 1);
