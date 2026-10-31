import { useEffect, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from 'react';
import { usePref } from '../ui/hooks';
import { setUi, useStore } from '../../store/store';
import { GalleryPanel } from '../gallery/GalleryPanel';
import { SessionsPanel } from './SessionsPanel';
import { SpendingPanel } from './SpendingPanel';

/** Drawer widths: never narrower than its header and controls need, never wider than the window leaves for the canvas. */
export const PANEL_MIN_W = 360;
const PANEL_DEFAULT_W = 370;
const maxW = () => Math.max(PANEL_MIN_W, window.innerWidth - 220);
const clamp = (w: number) => Math.round(Math.min(maxW(), Math.max(PANEL_MIN_W, w)));

/** The drawer's right edge: drag (or ←/→) to resize; double-click restores the default. The width is stored on release. */
function PanelResize({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const aside = el.parentElement as HTMLElement;
    const x0 = e.clientX;
    const w0 = aside.getBoundingClientRect().width;
    let w = w0;
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('is-dragging');
    const move = (ev: globalThis.PointerEvent) => { w = clamp(w0 + ev.clientX - x0); aside.style.setProperty('--side-w', `${w}px`); };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('is-dragging');
      if (w !== w0) onWidth(w);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 16 : e.key === 'ArrowLeft' ? -16 : 0;
    if (!step) return;
    e.preventDefault();
    onWidth(clamp(width + step));
  };
  return <div className="side-panel-resize" role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0}
    aria-valuemin={PANEL_MIN_W} aria-valuenow={width} onPointerDown={down} onKeyDown={key} onDoubleClick={() => onWidth(PANEL_DEFAULT_W)} />;
}

/* Drawers anchored to the sidebar. No scrim: assets can be dragged from the gallery onto canvases. */
export function SidePanel() {
  const panel = useStore((s) => s.ui.panel);
  const expanded = useStore((s) => s.ui.panelExpanded);
  const lightbox = useStore((s) => s.ui.lightbox);
  const [width, setWidth] = usePref('ogs.sidePanelWidth', PANEL_DEFAULT_W);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !lightbox && !document.querySelector('.popover')) setUi({ panel: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, lightbox]);

  if (!panel) return null;
  return (
    <aside className={`side-panel panel-${panel} ${expanded ? 'is-expanded' : ''}`} style={{ '--side-w': `${Math.max(PANEL_MIN_W, width)}px` } as CSSProperties} aria-label={panel === 'gallery' ? 'Gallery' : panel === 'spending' ? 'Spending' : 'Sessions'}>
      {panel === 'gallery' ? <GalleryPanel /> : panel === 'spending' ? <SpendingPanel /> : <SessionsPanel />}
      {expanded ? null : <PanelResize width={width} onWidth={setWidth} />}
    </aside>
  );
}
