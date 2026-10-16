import { useRef, useState, type PointerEvent } from 'react';
import { useStore } from '../../store/store';
import { usePref } from '../ui/hooks';
import { SpacePanel } from './SpacePanel';
import { SpaceBoard } from './SpaceBoard';

const MIN = 320, MAX = 560;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, Math.round(n)));

/** Create Media: the Space Panel (controls) on the left, the Space Board (results) on the right, a draggable divider between. */
export function CreateSpace() {
  const [saved, save] = usePref('ogs:space-panel-w', 400);
  const [drag, setDrag] = useState<number | null>(null);
  const mode = useStore((s) => s.composer.mode);
  const kind = mode === 'agent' ? 'image' : mode;
  const root = useRef<HTMLDivElement>(null);
  const width = clamp(drag ?? saved);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag == null) return;
    setDrag(clamp(e.clientX - (root.current?.getBoundingClientRect().left ?? 0)));
  };
  const end = () => { if (drag != null) { save(drag); setDrag(null); } };
  return <div ref={root} className="space" role="region" aria-label="Create Media" style={{ ['--space-w' as string]: `${width}px` }}>
    <SpacePanel />
    <div className={`space-divider ${drag != null ? 'is-dragging' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize panel" aria-valuenow={width} aria-valuemin={MIN} aria-valuemax={MAX} tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(width); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); save(clamp(width + (e.key === 'ArrowRight' ? 16 : -16))); } }} />
    <SpaceBoard kind={kind} empty="Nothing generated yet. Describe something and press Generate." />
  </div>;
}
