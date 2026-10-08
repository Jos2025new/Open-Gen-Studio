/*
 * Geometry of sheets and grid cuts, in one place: the cut (Grid-split, local and free), the number of views it makes, and
 * the order those views come in. Pure functions, so the same arithmetic can be checked without a canvas.
 */

export interface GridShape { rows: number; cols: number }
export interface CellRect { x: number; y: number; w: number; h: number }

/** grid_split's "grid": '2' and '3' are squares, '2x3' is two rows of three, 'row3' and 'row4' one row of views. */
export function gridShape(grid: unknown): GridShape {
  if (grid === 'row3') return { rows: 1, cols: 3 };
  if (grid === 'row4') return { rows: 1, cols: 4 };
  if (grid === '2x3') return { rows: 2, cols: 3 };
  const n = Number(grid) === 2 ? 2 : 3;
  return { rows: n, cols: n };
}

/** Equal cells, row by row. The remainder at the right and bottom edges is left out, as the cut always did. */
export function cellRects(shape: GridShape, width: number, height: number): CellRect[] {
  const w = Math.floor(width / shape.cols);
  const h = Math.floor(height / shape.rows);
  const cells: CellRect[] = [];
  for (let row = 0; row < shape.rows; row++) for (let col = 0; col < shape.cols; col++) cells.push({ x: col * w, y: row * h, w, h });
  return cells;
}

/**
 * How a reference sheet is cut into views, and the order the views are saved in (the main image first). A character
 * turnaround of three views is written side, front, back, so its front view is the second cell. Other sheets are 2×2.
 */
export function sheetCut(op: { id: string; params: Record<string, unknown> } | undefined): { grid: string; order: number[] } {
  const turnaround = op?.id === 'reference_sheet' && op.params.sheet === 'turnaround' && (op.params.subject ?? 'character') === 'character';
  if (turnaround && op.params.panels === '4') return { grid: 'row4', order: [0, 1, 2, 3] };
  if (turnaround) return { grid: 'row3', order: [1, 0, 2] };
  return { grid: '2', order: [0, 1, 2, 3] };
}
