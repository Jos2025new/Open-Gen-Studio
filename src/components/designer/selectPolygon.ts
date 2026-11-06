import type { SelectDown } from './StageSelect';

/* Polygon selection (P4). Skeleton: inert, so the shape falls back to a dragged rectangle until it is built. */

export const polygonDown = (_a: SelectDown): 'handled' | null => null;
/** Esc, Enter or Backspace on the polygon being drawn; true when the key was consumed. */
export const polygonKey = (_e: KeyboardEvent): boolean => false;
/** Throw the polygon draft away (tool, shape, document or layer changed). */
export const polygonCancel = (): void => {};
