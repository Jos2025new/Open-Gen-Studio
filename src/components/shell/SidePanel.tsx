import { useEffect } from 'react';
import { setUi, useStore } from '../../store/store';
import { GalleryPanel } from '../gallery/GalleryPanel';
import { SessionsPanel } from './SessionsPanel';

/* Drawers anchored to the sidebar. No scrim: assets can be dragged from the gallery onto canvases. */
export function SidePanel() {
  const panel = useStore((s) => s.ui.panel);
  const expanded = useStore((s) => s.ui.galleryExpanded);
  const lightbox = useStore((s) => s.ui.lightbox);

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
    <aside className={`side-panel panel-${panel} ${panel === 'gallery' && expanded ? 'is-expanded' : ''}`} aria-label={panel === 'gallery' ? 'Gallery' : 'Sessions'}>
      {panel === 'gallery' ? <GalleryPanel /> : <SessionsPanel />}
    </aside>
  );
}
