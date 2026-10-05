export interface Point { x: number; y: number }
export interface View extends Point { zoom: number }
type Origin = { left: number; top: number };

export function screenToDocument(point: Point, view: View, origin: Origin): Point {
  return { x: (point.x - origin.left - view.x) / view.zoom, y: (point.y - origin.top - view.y) / view.zoom };
}
export function documentToScreen(point: Point, view: View, origin: Origin): Point {
  return { x: origin.left + view.x + point.x * view.zoom, y: origin.top + view.y + point.y * view.zoom };
}
export function zoomAt(view: View, px: number, py: number, factor: number): View {
  const zoom = Math.min(8, Math.max(0.05, view.zoom * factor));
  const k = zoom / view.zoom;
  return { zoom, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}
