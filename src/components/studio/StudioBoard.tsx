import { useRef, type PointerEvent } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../ui/primitives';
import { SpaceBoard } from '../space/SpaceBoard';
import { EmbeddedNodeCanvas } from '../node/NodeWorkspace';
import { EmbeddedDesigner } from './EmbeddedDesigner';
import { BOARD_MIN, boardMax, setStudioBoard, useStudioBoard, type StudioView } from '../../lib/studioBoard';

const VIEWS: Array<{ id: StudioView; label: string }> = [{ id: 'assets', label: 'Generations' }, { id: 'nodes', label: 'Nodes' }, { id: 'designer', label: 'Designer' }];

/** Studio's right column: the Generations board (Done and Ongoing), resizable and closable. Closed, the composer's Show generations control reopens it. */
export function StudioBoard() {
  const { open, width, view } = useStudioBoard();
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ w: number; raf: number } | null>(null);
  if (!open) return null;
  // While dragging nothing goes through React: one frame at a time the board width and the workspace's --studio-w (the chat's padding and the composer) move together.
  const paint = (w: number) => {
    const el = root.current;
    if (!el) return;
    el.style.width = `${w}px`;
    el.parentElement?.style.setProperty('--studio-w', `${w}px`);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const right = root.current?.parentElement?.getBoundingClientRect().right ?? 0;
    d.w = Math.min(boardMax(), Math.max(BOARD_MIN, Math.round(right - e.clientX)));
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; paint(d.w); });
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    cancelAnimationFrame(d.raf);
    e.currentTarget.classList.remove('is-dragging');
    root.current?.parentElement?.classList.remove('is-resizing');
    paint(d.w);
    setStudioBoard({ width: d.w });
  };
  return <div ref={root} className="studio-board" aria-label="Studio board" style={{ width }}>
    <div className="studio-divider" role="separator" aria-orientation="vertical" aria-label="Resize board" aria-valuenow={width} aria-valuemin={BOARD_MIN} aria-valuemax={boardMax()} tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { w: width, raf: 0 }; e.currentTarget.classList.add('is-dragging'); root.current?.parentElement?.classList.add('is-resizing'); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
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
