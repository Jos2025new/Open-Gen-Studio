/*
 * Raster limit of the engine comparison (Tarea 2): each raster layer keeps its last `limit` strokes editable and
 * flattens every earlier one into its base buffer. A layer of 300 strokes therefore has 236 flattened and 64 editable;
 * a layer below the limit has none flattened. Pure: no DOM, no engine.
 */
export const EDITABLE_LIMIT = 64;

export function splitRasterLimit<T>(strokes: readonly T[], limit = EDITABLE_LIMIT): { flat: T[]; editable: T[] } {
  const cut = Math.max(0, strokes.length - limit);
  return { flat: strokes.slice(0, cut), editable: strokes.slice(cut) };
}
