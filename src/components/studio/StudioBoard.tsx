import { useRef, useState, type PointerEvent } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../ui/primitives';
import { SpaceBoard } from '../space/SpaceBoard';
import { EmbeddedNodeCanvas } from '../node/NodeWorkspace';
import { EmbeddedDesigner } from './EmbeddedDesigner';
import { BOARD_MAX, BOARD_MIN, setStudioBoard, useStudioBoard, type StudioView } from '../../lib/studioBoard';

const VIEWS: Array<{ id: StudioView; label: string }> = [{ id: 'assets', label: 'Generations' }, { id: 'nodes', label: 'Nodes' }, { id: 'designer', label: 'Designer' }];

/** Studio's right column: the Generations board (Done and Ongoing), resizable and closable. Closed, the composer's Show generations control reopens it. */
export function StudioBoard() {
  const { open, width, view } = useStudioBoard();
  const [drag, setDrag] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  if (!open) return null;
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
    <div className="studio-board-main">
      <div className="studio-views" role="tablist" aria-label="Board view">
        {VIEWS.map((v) => <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={`studio-view ${view === v.id ? 'is-active' : ''}`} onClick={() => setStudioBoard({ view: v.id })}>{v.label}</button>)}
        <span className="studio-views-end"><IconButton icon={X} label="Close board" size="sm" onClick={() => setStudioBoard({ open: false })} /></span>
      </div>
      {view === 'nodes' ? <EmbeddedNodeCanvas /> : view === 'designer' ? <EmbeddedDesigner /> : <SpaceBoard studio empty="Nothing generated yet. Ask for something in the chat." />}
    </div>
  </div>;
}
