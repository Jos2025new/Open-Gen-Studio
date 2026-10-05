import type { Layer, Stroke } from '../types';
import type { DesignTool } from './rules';
import type { Point } from './viewCoordinates';
import { nearestPoint } from './strokes';

export interface CursorTools {
  tool: DesignTool;
  brushSize: number;
  lineartSize: number;
  lineartMode: 'draw' | 'edit';
  influence: number;
  active: Layer | null;
  curveSelected: boolean;
}
export interface BendCursor { base: Stroke[]; stroke: number; influence?: number }
export interface CursorIndicator { radius: number; kind: 'brush' | 'influence' }
export function hasCursorPreview(options: CursorTools): boolean {
  return ['brush', 'eraser', 'lineart'].includes(options.tool) || (options.tool === 'move' && options.curveSelected);
}

/** The very radius passed to bendStroke, including the existing Alt-drag fallback. */
export function cursorIndicator(options: CursorTools, point: Point, zoom: number, alt: boolean, bend?: BendCursor | null): CursorIndicator | null {
  if (bend) return { radius: bend.influence ?? Math.max(24, bend.base[bend.stroke].size * 4), kind: 'influence' };
  if (options.tool === 'brush' || options.tool === 'eraser') return { radius: options.brushSize / 2, kind: 'brush' };
  if (options.tool === 'move' && options.curveSelected || options.tool === 'lineart' && options.lineartMode === 'edit') return { radius: options.influence, kind: 'influence' };
  if (options.tool !== 'lineart') return null;
  const layer = options.active;
  if (alt && layer?.type === 'vector' && !layer.locked && !layer.shapes.length && layer.strokes?.length) {
    const hit = nearestPoint(layer.strokes, point.x, point.y, 12 / zoom);
    if (hit) return { radius: Math.max(24, layer.strokes[hit.stroke].size * 4), kind: 'influence' };
  }
  return { radius: options.lineartSize / 2, kind: 'brush' };
}
