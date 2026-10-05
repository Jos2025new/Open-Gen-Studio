import type { CursorIndicator } from '../../engine/design/cursorPreview';
import type { Point, View } from '../../engine/design/viewCoordinates';

/** One overlay for raster, vector and influence sizes, outside the document render. */
export function BrushCursor({ point, view, indicator }: { point: Point | null; view: View; indicator: CursorIndicator | null }) {
  if (!point || !indicator) return null;
  const radius = indicator.radius * view.zoom;
  return <div aria-hidden data-brush-cursor={indicator.kind} data-radius={indicator.radius} style={{
    position: 'absolute', left: 0, top: 0, pointerEvents: 'none', borderRadius: '50%',
    width: radius * 2, height: radius * 2,
    transform: `translate(${view.x + point.x * view.zoom - radius}px, ${view.y + point.y * view.zoom - radius}px)`,
    boxSizing: 'border-box', border: '1px solid #ffffff', boxShadow: '0 0 0 1px #16161a, inset 0 0 0 1px #16161a',
  }} />;
}
