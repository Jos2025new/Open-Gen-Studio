import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { ToolRail } from './ToolRail';
import { ToolSettings } from './ToolSettings';

export function ToolPalette({ history, view, ...settings }: ComponentProps<typeof ToolSettings> & { history: ReactNode; view: ReactNode }) {
  const palette = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = palette.current;
    const designer = el?.closest<HTMLElement>('.designer');
    const stage = designer?.querySelector<HTMLElement>('.stage');
    if (!el || !designer || !stage) return;
    const placeHint = () => designer.style.setProperty('--stage-hint-top', `${Math.max(12, el.getBoundingClientRect().bottom - stage.getBoundingClientRect().top + 8)}px`);
    const observer = new ResizeObserver(placeHint);
    observer.observe(el);
    observer.observe(stage);
    window.addEventListener('resize', placeHint);
    placeHint();
    return () => { observer.disconnect(); window.removeEventListener('resize', placeHint); designer.style.removeProperty('--stage-hint-top'); };
  }, [settings.doc.id]);
  return <>
    <div ref={palette} className="designer-palette">
      <ToolRail sessionId={settings.sessionId} doc={settings.doc} />
    </div>
    <div className="designer-view" role="toolbar" aria-label="Canvas view" aria-orientation="vertical">
      <div className="view-history">{history}</div>
      {view}
    </div>

  </>;
}
