import { describe, expect, it } from 'vitest';
import { clampRatio, packRows, rowHeightFor } from '../src/lib/justifiedRows';

const items = (...ratios: number[]) => ratios.map((ratio, i) => ({ id: `i${i}`, ratio }));
const rowWidth = (cells: { width: number }[], gap: number) => cells.reduce((s, c) => s + c.width, 0) + gap * (cells.length - 1);

describe('packRows', () => {
  it('fills every full row to the container width with equal heights and keeps each ratio', () => {
    const data = items(1.5, 1, 0.75, 1.78, 1, 0.66, 1.33, 1, 1, 1.5);
    const rows = packRows(data, 1000, 200, 8);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(0, -1)) {
      expect(rowWidth(row.cells, 8)).toBeCloseTo(1000, 6);
      for (const c of row.cells) expect(c.height).toBeCloseTo(row.height, 9);
    }
    const flat = rows.flatMap((r) => r.cells);
    expect(flat.map((c) => c.id)).toEqual(data.map((d) => d.id)); // order and count kept
    flat.forEach((c, i) => expect(c.width / c.height).toBeCloseTo(data[i].ratio, 6)); // no cropping to squares
  });

  it('does not stretch the last row: it keeps the target height and stays narrower than the container', () => {
    const rows = packRows(items(1, 1, 1, 1, 1, 1, 1), 1000, 200, 0);
    const last = rows[rows.length - 1];
    expect(last.height).toBe(200);
    expect(rowWidth(last.cells, 0)).toBeLessThan(1000);
    expect(rows[0].height).toBeCloseTo(1000 / 5, 9); // five squares fill a row
  });

  it('a single wide tile never overflows the container, and a bigger target means fewer tiles per row', () => {
    const [only] = packRows(items(3), 300, 400, 0);
    expect(rowWidth(only.cells, 0)).toBeLessThanOrEqual(300 + 1e-9);
    const small = packRows(items(...Array(12).fill(1)), 1000, 100, 4);
    const large = packRows(items(...Array(12).fill(1)), 1000, 300, 4);
    expect(small[0].cells.length).toBeGreaterThan(large[0].cells.length);
    expect(rowHeightFor(8)).toBeGreaterThan(rowHeightFor(2));
  });

  it('treats unknown or extreme ratios safely and returns nothing without a width', () => {
    expect(clampRatio(0)).toBe(1);
    expect(clampRatio(NaN)).toBe(1);
    expect(clampRatio(10)).toBe(3);
    expect(packRows(items(1, 1), 0, 200)).toEqual([]);
    expect(packRows([], 500, 200)).toEqual([]);
  });
});
