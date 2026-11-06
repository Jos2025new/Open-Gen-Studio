import { useRef } from 'react';
import { useStore } from '../../store/store';
import type { CursorIndicator } from '../../engine/design/cursorPreview';
import type { Point, View } from '../../engine/design/viewCoordinates';

/** One overlay for raster, vector and influence sizes, outside the document render. A brush or eraser shows its tip: squeezed and turned as it paints. */
export function BrushCursor({ point, view, indicator }: { point: Point | null; view: View; indicator: CursorIndicator | null }) {
  const tip = useStore((s) => (s.ui.tool === 'brush' || s.ui.tool === 'eraser' ? s.ui.brush : undefined));
  const heading = useRef({ x: 0, y: 0, deg: 0 });
  if (!point || !indicator) return null;
  const radius = indicator.radius * view.zoom;
  const shaped = indicator.kind === 'brush' && tip?.roundness !== undefined && tip.roundness < 1 ? tip : undefined;
  // With Follow stroke the tip turns with the direction the pointer travels.
  const h = heading.current, dx = point.x - h.x, dy = point.y - h.y;
  if (Math.hypot(dx, dy) * view.zoom > 3) { h.deg = (Math.atan2(-dy, dx) * 180) / Math.PI; h.x = point.x; h.y = point.y; }
  const across = shaped ? Math.max(1, radius * shaped.roundness!) : radius;
  const angle = shaped ? (shaped.angle ?? 0) + (shaped.follow ? h.deg : 0) : 0;
  return <div aria-hidden data-brush-cursor={indicator.kind} data-radius={indicator.radius} data-tip-shape={shaped ? `${shaped.roundness} ${angle}` : undefined} style={{
    position: 'absolute', left: 0, top: 0, pointerEvents: 'none', borderRadius: '50%',
    width: radius * 2, height: across * 2,
    transform: `translate(${view.x + point.x * view.zoom - radius}px, ${view.y + point.y * view.zoom - across}px)${angle ? ` rotate(${-angle}deg)` : ''}`,
    boxSizing: 'border-box', border: '1px solid #ffffff', boxShadow: '0 0 0 1px #16161a, inset 0 0 0 1px #16161a',
  }} />;
}
