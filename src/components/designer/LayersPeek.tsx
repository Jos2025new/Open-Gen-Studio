import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { AlertTriangle, PanelRightOpen } from 'lucide-react';
import { IconButton } from '../ui/primitives';
import '../../styles/layers-peek.css';

/**
 * The Designer's right panel, unpinned: as with the app bar's icon, hovering or focusing the corner icon (or the right
 * edge) shows the panel floating over the canvas without moving anything; leaving hides it after a short pause (not
 * while one of its menus is open); clicking the icon, or the pin in the panel, pins it.
 */
export function usePanelPeek(unpinned: boolean) {
  const [peek, setPeek] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const panel = useRef<HTMLElement | null>(null);
  const show = () => { window.clearTimeout(timer.current); if (unpinned) setPeek(true); };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (panel.current?.querySelector('[aria-haspopup][aria-expanded="true"]')) return hide();
      setPeek(false);
    }, 280);
  };
  useEffect(() => { if (!unpinned) setPeek(false); }, [unpinned]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const on = unpinned && peek;
  const panelProps = on ? {
    ref: (el: HTMLElement | null) => { panel.current = el; },
    onMouseEnter: show,
    onMouseLeave: hide,
    onBlur: (e: FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide(); },
  } : {};
  return { on, show, hide, panelProps };
}

/** Unpinned and not peeking: the right edge and one icon in the corner (with the paint warning under it when needed). */
export function PanelPeekHandle({ warn, onPin, show, hide }: { warn: boolean; onPin: () => void; show: () => void; hide: () => void }) {
  return <>
    <div className="layers-peek-edge" aria-hidden onMouseEnter={show} onMouseLeave={hide} />
    <aside className="layers-peek-handle" aria-label="Layers">
      <IconButton icon={PanelRightOpen} label="Pin layers panel" size="sm" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onClick={onPin} />
      {warn ? <IconButton icon={AlertTriangle} label="Open layers panel to confirm painting" size="sm" onClick={onPin} /> : null}
    </aside>
  </>;
}
