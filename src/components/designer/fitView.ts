/**
 * Fit canvas: centered in the stage, the room the pinned right panel leaves. The prompt box is centered there too
 * (tool-dock.css), so canvas and box share one line and both sit in the middle of what the user sees.
 * Studio's embedded Designer (`board`) reserves its own bottom.
 */
export function fitView(size: { w: number; h: number }, doc: { width: number; height: number }, board?: { bottom: number }) {
  // Thin margin, as Photoshop or Krita; the bottom clears the toolbar (below the canvas on narrow screens).
  const pad = size.w < 500 ? 12 : 24;
  const bottom = board?.bottom ?? (window.innerWidth < 768 ? 12 : 120);
  const zoom = Math.max(0.05, Math.min((size.w - pad * 2) / doc.width, (size.h - pad - bottom) / doc.height, 4));
  return { zoom, x: (size.w - doc.width * zoom) / 2, y: Math.max(pad / 2, (size.h - bottom - doc.height * zoom) / 2) };
}
