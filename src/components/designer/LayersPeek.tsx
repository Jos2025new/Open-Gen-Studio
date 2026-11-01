import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { AlertTriangle, Layers, SlidersHorizontal, Wrench } from 'lucide-react';
import { IconButton } from '../ui/primitives';
import '../../styles/layers-peek.css';

type Tab = 'props' | 'tool' | 'layers';
// The panel's three tabs, as in its header.
const TABS = [['props', SlidersHorizontal, 'Properties'], ['tool', Wrench, 'Tool'], ['layers', Layers, 'Layers']] as const;

/**
 * The Designer's right panel, unpinned: like the side toolbox, a vertical bar of its tabs; hovering or focusing a tab
 * (or the right edge) shows the panel floating at the bar's left without moving anything; leaving hides it after a
 * short pause (not while one of its menus is open); clicking a tab pins the panel on it.
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

/** Unpinned: the right edge and the bar of tabs (with the paint warning under them when needed); stays while the panel peeks, its tab marked (`tab`). */
export function PanelPeekHandle({ warn, tab, onTab, show, hide }: { warn: boolean; tab: Tab | null; onTab: (id: Tab, pin: boolean) => void; show: () => void; hide: () => void }) {
  return <>
    <div className="layers-peek-edge" aria-hidden onMouseEnter={show} onMouseLeave={hide} />
    <aside className="layers-peek-handle" role="toolbar" aria-label="Layers panel" aria-orientation="vertical">
      {TABS.map(([id, Icon, name]) => (
        <IconButton key={id} icon={Icon} label={`${name} · click to pin`} size="sm" active={tab === id} aria-pressed={tab === id} tipSide="right"
          onMouseEnter={() => { onTab(id, false); show(); }} onMouseLeave={hide} onFocus={() => { onTab(id, false); show(); }} onClick={() => onTab(id, true)} />
      ))}
      {warn ? <IconButton icon={AlertTriangle} label="Open layers panel to confirm painting" size="sm" onClick={() => onTab('layers', true)} /> : null}
    </aside>
  </>;
}
