import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Library } from 'lucide-react';
import { usePref } from '../ui/hooks';
import { IconButton } from '../ui/primitives';
import { openLibrary } from '../shell/navModel';

const MIN = 320, MAX = 560;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, Math.round(n)));

/** The Space layout shared by Create and Tools: panel | draggable divider | board. The width is one UI preference. */
export function SpaceFrame({ label, panel, board }: { label: string; panel: ReactNode; board: ReactNode }) {
  const [saved, save] = usePref('ogs:space-panel-w', 400);
  const [drag, setDrag] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const width = clamp(drag ?? saved);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag == null) return;
    setDrag(clamp(e.clientX - (root.current?.getBoundingClientRect().left ?? 0)));
  };
  const end = () => { if (drag != null) { save(drag); setDrag(null); } };
  return <div ref={root} className="space" role="region" aria-label={label} style={{ ['--space-w' as string]: `${width}px` }}>
    {panel}
    <div className={`space-divider ${drag != null ? 'is-dragging' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize panel" aria-valuenow={width} aria-valuemin={MIN} aria-valuemax={MAX} tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(width); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); save(clamp(width + (e.key === 'ArrowRight' ? 16 : -16))); } }} />
    {board}
  </div>;
}

/** Space name and the Library icon (the Library as a full page, via Home). */
export function SpaceHead({ title }: { title: string }) {
  return <header className="space-panel-head">
    <h2 className="space-panel-title">{title}</h2>
    <IconButton icon={Library} label="Library" size="sm" onClick={openLibrary} />
  </header>;
}
