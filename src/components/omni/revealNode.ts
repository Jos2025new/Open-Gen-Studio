import type { ReactFlowInstance } from '@xyflow/react';

/** After adding a node, pan (keeping the zoom) only when the node ended up outside the visible part of the canvas, so it is never added out of sight. */
export function revealRect(rf: ReactFlowInstance, canvas: HTMLElement | null, rect: { x: number; y: number; width: number; height: number }): void {
  const box = canvas?.getBoundingClientRect();
  if (!box) return;
  const a = rf.flowToScreenPosition({ x: rect.x, y: rect.y });
  const b = rf.flowToScreenPosition({ x: rect.x + rect.width, y: rect.y + rect.height });
  const margin = 24;
  const inside = a.x >= box.left + margin && a.y >= box.top + margin && b.x <= box.right - margin && b.y <= box.bottom - margin;
  if (inside) return;
  void rf.setCenter(rect.x + rect.width / 2, rect.y + rect.height / 2, { zoom: rf.getZoom(), duration: 200 });
}
