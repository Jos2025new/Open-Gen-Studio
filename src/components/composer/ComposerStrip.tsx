import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { AgentControls } from './AgentControls';
import { AgentModelControls } from './AgentModelControls';
import { MediaControls, ModelChip } from './MediaControls';
import { DesignerFooterTools } from '../designer/ToolPalette';
import { useStore } from '../../store/store';

/** The settings of the mode just above the prompt, without a background: the model at the far end, the rest in a row that scrolls with « » when it does not fit. */
export function ComposerStrip({ target }: { /** What a generation lands on, when the workspace has a choice. */ target?: ReactNode }) {
  const mode = useStore((s) => s.composer.mode);
  const workspace = useStore((s) => s.ui.workspace);
  const rail = useRef<HTMLDivElement>(null);
  const [can, setCan] = useState({ back: false, on: false });
  const measure = () => {
    const r = rail.current;
    if (!r) return;
    const back = r.scrollLeft > 1, on = r.scrollLeft < r.scrollWidth - r.clientWidth - 1;
    setCan((c) => (c.back === back && c.on === on ? c : { back, on }));
  };
  useEffect(() => {
    const r = rail.current;
    if (!r || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(r);
    for (const child of r.children) observer.observe(child);
    return () => observer.disconnect();
  });
  const nudge = (by: number) => rail.current?.scrollBy({ left: by, behavior: 'smooth' });
  const agent = mode === 'agent', designer = workspace === 'designer';
  return <div className="composer-strip" aria-label="Mode settings" role="group">
    {can.back ? <button type="button" className="composer-strip-nudge" aria-label="Previous settings" onClick={() => nudge(-160)}><ChevronsLeft size={14} /></button> : null}
    <div ref={rail} className="composer-strip-rail" onScroll={measure}>
      {agent ? <AgentControls showMode={!designer} activeOnly={false} /> : <MediaControls kind={mode} showModel={false} />}
      {target}
    </div>
    {can.on ? <button type="button" className="composer-strip-nudge" aria-label="More settings" onClick={() => nudge(160)}><ChevronsRight size={14} /></button> : null}
    <div className="composer-strip-end">
      {designer ? <DesignerFooterTools /> : null}
      {agent ? (designer ? null : <AgentModelControls />) : <ModelChip kind={mode} />}
    </div>
  </div>;
}
