import { useRef, useState, type PointerEvent } from 'react';
import { PanelRight } from 'lucide-react';
import { IconButton } from '../ui/primitives';
import { SpaceBoard } from '../space/SpaceBoard';
import { BOARD_MAX, BOARD_MIN, setStudioBoard, useStudioBoard } from './studioBoard';

/** Studio's right column: the Generations board (Done and Ongoing), resizable and closable. Closed, a small control reopens it. */
export function StudioBoard() {
  const { open, width } = useStudioBoard();
  const [drag, setDrag] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  if (!open) return <div className="studio-reopen"><IconButton icon={PanelRight} label="Show generations" size="sm" onClick={() => setStudioBoard({ open: true })} /></div>;
  const shown = drag ?? width;
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag == null) return;
    const right = root.current?.parentElement?.getBoundingClientRect().right ?? 0;
    setDrag(Math.min(BOARD_MAX, Math.max(BOARD_MIN, Math.round(right - e.clientX))));
  };
  const end = () => { if (drag != null) { setStudioBoard({ width: drag }); setDrag(null); } };
  return <div ref={root} className="studio-board" aria-label="Studio board" style={{ width: shown }}>
    <div className={`studio-divider ${drag != null ? 'is-dragging' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize board" aria-valuenow={shown} aria-valuemin={BOARD_MIN} aria-valuemax={BOARD_MAX} tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(width); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setStudioBoard({ width: width + (e.key === 'ArrowLeft' ? 16 : -16) }); } }} />
    <SpaceBoard studio empty="Nothing generated yet. Ask for something in the chat." onClose={() => setStudioBoard({ open: false })} />
  </div>;
}
