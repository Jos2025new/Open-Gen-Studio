/**
 * Fit canvas, Figma's way: the prompt box stays at the workspace's center whatever the panels do (tool-dock.css),
 * so the canvas is centered on that same line, zoomed to clear the right panel and the edges on both sides of it.
 * Studio's embedded Designer (`board`) has no prompt box of its own: it centers on its own box.
 */
export function fitView(el: HTMLElement | null, size: { w: number; h: number }, doc: { width: number; height: number }, board?: { bottom: number }) {
  // Thin margin, as Photoshop or Krita; the bottom clears the toolbar (below the canvas on narrow screens).
  const pad = size.w < 500 ? 12 : 24;
  const bottom = board?.bottom ?? (window.innerWidth < 768 ? 12 : 120);
  const host = board ? null : el?.closest('.ws-designer');
  const own = el?.getBoundingClientRect();
  const ws = host?.getBoundingClientRect();
  const cx = own && ws?.width ? Math.min(size.w, Math.max(0, ws.left + ws.width / 2 - own.left)) : size.w / 2;
  const half = Math.max(1, Math.min(cx, size.w - cx) - pad);
  const zoom = Math.max(0.05, Math.min((half * 2) / doc.width, (size.h - pad - bottom) / doc.height, 4));
  return { zoom, x: cx - (doc.width * zoom) / 2, y: Math.max(pad / 2, (size.h - bottom - doc.height * zoom) / 2) };
}
