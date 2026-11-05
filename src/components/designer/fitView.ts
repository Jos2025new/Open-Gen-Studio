/**
 * Fit canvas: centered in the window, on one line with the prompt box (tool-dock.css). The pinned right panel floats, so
 * the margin it needs is left on both sides: the canvas never sits under it and pinning does not move the center.
 * Studio's embedded Designer (`board`) reserves its own bottom and has no such panel.
 */
export function fitView(size: { w: number; h: number }, doc: { width: number; height: number }, board?: { bottom: number }) {
  // Thin margin, as Photoshop or Krita; the bottom clears the toolbar (below the canvas on narrow screens).
  const pad = size.w < 500 ? 12 : 24;
  const bottom = board?.bottom ?? (window.innerWidth < 768 ? 12 : 120);
  const panel = !board && window.innerWidth >= 768 ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--layers-w')) || 0 : 0;
  const side = pad + (panel ? panel + 12 : 0);
  const zoom = Math.max(0.05, Math.min((size.w - side * 2) / doc.width, (size.h - pad - bottom) / doc.height, 4));
  return { zoom, x: (size.w - doc.width * zoom) / 2, y: Math.max(pad / 2, (size.h - bottom - doc.height * zoom) / 2) };
}
