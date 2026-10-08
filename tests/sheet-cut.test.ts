import { describe, expect, it } from 'vitest';
import { OPS, opCount } from '../src/engine/ops';
import { cellRects, gridShape, sheetCut } from '../src/engine/sheet';

/*
 * Simulated sheets: no model and no canvas. A generated sheet is drawn as the prompt asks, one equal panel per view,
 * left to right and top to bottom. Each pixel carries the label of its panel. The cut and the order are the app's own
 * functions; the test checks that every cut view holds exactly one panel and that the main view is the front one.
 */

/** A sheet of w×h pixels where every pixel holds the index of the panel it belongs to, panels drawn as the prompt asks. */
function drawSheet(shape: { rows: number; cols: number }, w: number, h: number): number[][] {
  const pw = w / shape.cols;
  const ph = h / shape.rows;
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => Math.floor(y / ph) * shape.cols + Math.floor(x / pw)));
}

/** The cut: each cell of the grid, read back from the sheet. A cell is valid when all its pixels carry one label. */
function cutLabels(sheet: number[][], cells: Array<{ x: number; y: number; w: number; h: number }>): Array<number | null> {
  return cells.map((c) => {
    const seen = new Set<number>();
    for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) seen.add(sheet[y][x]);
    return seen.size === 1 ? [...seen][0] : null;
  });
}

describe('grid shapes', () => {
  it('2 and 3 are squares, 2x3 is two rows of three, row3 and row4 are one row of views', () => {
    expect(gridShape('2')).toEqual({ rows: 2, cols: 2 });
    expect(gridShape('3')).toEqual({ rows: 3, cols: 3 });
    expect(gridShape('2x3')).toEqual({ rows: 2, cols: 3 });
    expect(gridShape('row3')).toEqual({ rows: 1, cols: 3 });
    expect(gridShape('row4')).toEqual({ rows: 1, cols: 4 });
  });

  it('grid_split counts its views from the shape: six for 2x3, four for row4', () => {
    expect(opCount(OPS.grid_split, { grid: '2x3' })).toBe(6);
    expect(opCount(OPS.grid_split, { grid: 'row4' })).toBe(4);
    expect(opCount(OPS.grid_split, { grid: '3' })).toBe(9);
    expect(opCount(OPS.grid_split, { grid: 'row3' })).toBe(3);
  });
});

describe('simulated cuts: each view holds exactly one drawn panel', () => {
  it('a 6-angle sheet (2×3) cuts into six views, one per panel', () => {
    const shape = gridShape('2x3');
    const sheet = drawSheet(shape, 60, 40);
    expect(cutLabels(sheet, cellRects(shape, 60, 40))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('a 9-angle sheet (3×3) cuts into nine views', () => {
    const shape = gridShape('3');
    expect(cutLabels(drawSheet(shape, 90, 90), cellRects(shape, 90, 90))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('a 4-view turnaround cuts into four views, left to right', () => {
    const shape = gridShape('row4');
    expect(cutLabels(drawSheet(shape, 100, 50), cellRects(shape, 100, 50))).toEqual([0, 1, 2, 3]);
  });

  it('a 3-view turnaround cuts into three views, left to right', () => {
    const shape = gridShape('row3');
    expect(cutLabels(drawSheet(shape, 90, 40), cellRects(shape, 90, 40))).toEqual([0, 1, 2]);
  });

  it('a size that does not divide evenly loses only the edge remainder, never overlaps', () => {
    const cells = cellRects(gridShape('2x3'), 61, 41);
    expect(cells.every((c) => c.x + c.w <= 61 && c.y + c.h <= 41)).toBe(true);
    expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(6);
  });
});

describe('the main view of a turnaround is its front view', () => {
  // The prompt draws the 3-view turnaround side, front, back and the 4-view one front, three-quarter, side, back.
  const drawn3 = ['side', 'front', 'back'];
  const drawn4 = ['front', 'three-quarter', 'side', 'back'];

  it('3 views: the cut order puts the front view first', () => {
    const { grid, order } = sheetCut({ id: 'reference_sheet', params: { sheet: 'turnaround', subject: 'character', panels: '3' } });
    expect(grid).toBe('row3');
    const cut = cutLabels(drawSheet(gridShape(grid), 90, 40), cellRects(gridShape(grid), 90, 40)) as number[];
    const views = order.map((i) => drawn3[cut[i]]);
    expect(views[0]).toBe('front');
    expect(views).toEqual(['front', 'side', 'back']);
  });

  it('4 views: drawn front first, so the front view is already first', () => {
    const { grid, order } = sheetCut({ id: 'reference_sheet', params: { sheet: 'turnaround', subject: 'character', panels: '4' } });
    expect(grid).toBe('row4');
    const cut = cutLabels(drawSheet(gridShape(grid), 100, 50), cellRects(gridShape(grid), 100, 50)) as number[];
    const views = order.map((i) => drawn4[cut[i]]);
    expect(views).toEqual(drawn4);
  });

  it('other sheets are cut 2×2 in drawing order', () => {
    expect(sheetCut({ id: 'reference_sheet', params: { sheet: 'expressions', subject: 'character', panels: '3' } })).toEqual({ grid: '2', order: [0, 1, 2, 3] });
    expect(sheetCut({ id: 'reference_sheet', params: { sheet: 'turnaround', subject: 'object', panels: '4' } })).toEqual({ grid: '2', order: [0, 1, 2, 3] });
  });
});
