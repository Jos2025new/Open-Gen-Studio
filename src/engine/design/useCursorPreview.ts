import { useEffect, useState, type RefObject } from 'react';
import { cursorIndicator, hasCursorPreview, type BendCursor, type CursorTools } from './cursorPreview';
import { screenToDocument, type Point, type View } from './viewCoordinates';

/** No animation loop: view changes project the last screen pointer again. */
export function useCursorPreview(view: View, canvas: RefObject<HTMLCanvasElement | null>, options: CursorTools, bend: BendCursor | null) {
  const [screen, setScreen] = useState<Point | null>(null);
  const [alt, setAlt] = useState(false);
  const enabled = hasCursorPreview(options);
  useEffect(() => {
    if (!enabled) { setScreen(null); setAlt(false); return; }
    const key = (e: KeyboardEvent) => setAlt(e.altKey);
    const blur = () => { setScreen(null); setAlt(false); };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur); };
  }, [enabled]);
  const point = enabled && screen && canvas.current ? screenToDocument(screen, view, canvas.current.getBoundingClientRect()) : null;
  return {
    point,
    indicator: point ? cursorIndicator(options, point, view.zoom, alt, bend) : null,
    move: (e: { clientX: number; clientY: number; altKey: boolean }) => {
      if (enabled) { setScreen({ x: e.clientX, y: e.clientY }); setAlt(e.altKey); }
    },
    leave: () => setScreen(null),
  };
}
