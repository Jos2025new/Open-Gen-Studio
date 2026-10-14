export interface RectBounds { x: number; y: number; w: number; h: number }
export interface MarqueeBounds { left: number; top: number; right: number; bottom: number }

/** Inkscape-style rubberband: left-to-right encloses; right-to-left crosses. */
export function marqueeBounds(x0: number, y0: number, x1: number, y1: number): MarqueeBounds {
  return { left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) };
}

export function marqueeContains(bounds: MarqueeBounds, target: RectBounds): boolean {
  return target.x >= bounds.left && target.y >= bounds.top && target.x + target.w <= bounds.right && target.y + target.h <= bounds.bottom;
}

/** Direction-independent enclosure: changing the drag direction never changes the selected set. */
export function marqueeIds<T extends { id: string; box: RectBounds }>(targets: T[], x0: number, y0: number, x1: number, y1: number): string[] {
  const bounds = marqueeBounds(x0, y0, x1, y1);
  return targets.filter((target) => marqueeContains(bounds, target.box)).map((target) => target.id);
}
