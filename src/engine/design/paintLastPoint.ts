import type { DesignDoc } from '../types';

/** Where the last brush or eraser stroke on this layer ended, for Shift+click straight lines. Skeleton: always null, so a stroke starts where the pointer is. */
export function lastPaintPoint(_doc: DesignDoc, _layerId: string, _erase: boolean): { x: number; y: number } | null {
  return null;
}
