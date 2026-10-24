export interface RectBounds { x: number; y: number; w: number; h: number }
export interface MarqueeBounds { left: number; top: number; right: number; bottom: number }

/** Inkscape-style rubberband: left-to-right encloses; right-to-left crosses. */
export function marqueeBounds(x0: number, y0: number, x1: number, y1: number): MarqueeBounds {
  return { left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) };
}

/** A target the rectangle touches or crosses (the Edit marquee selects what it reaches, not only what it encloses). */
export function marqueeTouches(bounds: MarqueeBounds, target: RectBounds): boolean {
  return target.x <= bounds.right && target.y <= bounds.bottom && target.x + target.w >= bounds.left && target.y + target.h >= bounds.top;
}

export function marqueeContains(bounds: MarqueeBounds, target: RectBounds): boolean {
  return target.x >= bounds.left && target.y >= bounds.top && target.x + target.w <= bounds.right && target.y + target.h <= bounds.bottom;
}

/** Direction-independent: every target the rectangle touches; changing the drag direction never changes the selected set. */
export function marqueeIds<T extends { id: string; box: RectBounds }>(targets: T[], x0: number, y0: number, x1: number, y1: number): string[] {
  const bounds = marqueeBounds(x0, y0, x1, y1);
  return targets.filter((target) => marqueeTouches(bounds, target.box)).map((target) => target.id);
}
