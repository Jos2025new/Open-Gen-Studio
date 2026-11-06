import { useLayoutEffect, useRef } from 'react';

/**
 * Fit canvas: centered in the window, on one line with the prompt box (tool-dock.css). The pinned right panel floats, so
 * the margin it needs is left on both sides: the canvas never sits under it and pinning does not move the center.
 * Studio's embedded Designer (`board`) reserves its own bottom and has no such panel.
 */
export function fitView(size: { w: number; h: number }, doc: { width: number; height: number }, board?: { bottom: number }) {
  // Thin margin, as Photoshop or Krita; the bottom clears the bar and the sides the toolbox and the panel's tabs (a phone stacks the panel under a shorter stage).
  const pad = size.w < 500 ? 12 : 24;
  const phone = window.innerWidth <= 540;
  const bottom = board?.bottom ?? (phone ? 12 : 120);
  const panel = !board && !phone ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--layers-w')) || 0 : 0;
  const side = panel ? pad + panel + 12 : board || phone ? pad : Math.max(pad, 72);
  const zoom = Math.max(0.05, Math.min((size.w - side * 2) / doc.width, (size.h - pad - bottom) / doc.height, 4));
  return { zoom, x: (size.w - doc.width * zoom) / 2, y: Math.max(pad / 2, (size.h - bottom - doc.height * zoom) / 2) };
}

/** A window that changes size keeps what the user framed around the middle of the view. */
export function useKeepCenter(size: { w: number; h: number }, setView: (next: (v: { zoom: number; x: number; y: number }) => { zoom: number; x: number; y: number }) => void) {
  const last = useRef(size);
  useLayoutEffect(() => {
    const dw = size.w - last.current.w, dh = size.h - last.current.h;
    last.current = size;
    if (dw || dh) setView((v) => ({ ...v, x: v.x + dw / 2, y: v.y + dh / 2 }));
  }, [size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
}
