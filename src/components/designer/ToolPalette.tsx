import { type ComponentProps, type ReactNode } from 'react';
import { ToolDock } from './ToolDock';
import { ToolSettings } from './ToolSettings';
import { useStore } from '../../store/store';

/**
 * The toolbox outside the prompt box: the same strip as in the composer, turned upright at the left, with the canvas view
 * (zoom, fit, view toggles) under it in one frame. With the toolbox in the composer, the view stays on its own.
 */
export function ToolPalette({ history, view, ...settings }: ComponentProps<typeof ToolSettings> & { history?: ReactNode; view: ReactNode }) {
  const docked = (useStore((s) => s.ui.designerDock) ?? 'tools') === 'tools';
  const viewBar = <div className="designer-view" role="toolbar" aria-label="Canvas view" aria-orientation="vertical">
    {history ? <div className="view-history">{history}</div> : null}
    {view}
  </div>;
  if (docked) return viewBar;
  return <div className="designer-side">
    <div className="designer-palette is-side">
      <ToolDock sessionId={settings.sessionId} doc={settings.doc} selectedCurve={settings.selectedCurve} vertical />
    </div>
    {viewBar}
  </div>;
}
