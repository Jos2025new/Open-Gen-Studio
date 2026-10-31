/** One tile of a justified layout: its id and width/height ratio (1 when unknown). */
export interface JItem { id: string; ratio: number }
export interface JCell { id: string; width: number; height: number }
export interface JRow { height: number; cells: JCell[] }

export const MIN_RATIO = 0.4;
export const MAX_RATIO = 3;
/** Extreme panoramas and strips are limited so a row never depends on one tile. */
export const clampRatio = (r: number): number => (Number.isFinite(r) && r > 0 ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, r)) : 1);

/** Slider value (Grid size, bigger = larger tiles) to the target row height in px. */
export const rowHeightFor = (value: number): number => 60 + value * 28;

/**
 * Packs items into rows of equal height, Google Photos style: each tile's width follows its ratio, every full row
 * is scaled so its tiles plus gaps fill `width` exactly, and the last row keeps the target height (it is not stretched).
 * Pure and linear in the number of items.
 */
export function packRows(items: JItem[], width: number, targetHeight: number, gap = 0): JRow[] {
  const rows: JRow[] = [];
  if (width <= 0 || targetHeight <= 0) return rows;
  let row: JItem[] = [];
  let sum = 0;
  const flush = (full: boolean) => {
    if (!row.length) return;
    const room = width - gap * (row.length - 1);
    const height = full ? room / sum : Math.min(targetHeight, room / sum);
    rows.push({ height, cells: row.map((it) => ({ id: it.id, width: clampRatio(it.ratio) * height, height })) });
    row = [];
    sum = 0;
  };
  for (const item of items) {
    const r = clampRatio(item.ratio);
    row.push({ id: item.id, ratio: r });
    sum += r;
    if (sum * targetHeight + gap * (row.length - 1) >= width) flush(true);
  }
  flush(false);
  return rows;
}
