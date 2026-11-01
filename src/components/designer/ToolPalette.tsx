import { type ComponentProps, type ReactNode } from 'react';
import { PanelBottom, PanelLeft } from 'lucide-react';
import { ToolDock } from './ToolDock';
import { ToolSettings } from './ToolSettings';
import { setUi, useStore } from '../../store/store';
import { IconButton } from '../ui/primitives';

/**
 * The toolbox outside the prompt box: the same strip as in the composer, turned upright at the left, with the canvas view
 * (zoom, fit, view toggles) under it in one frame. With the toolbox in the composer, the view stays on its own. The last
 * button of the view moves the toolbox between the two places.
 */
export function ToolPalette({ history, view, ...settings }: ComponentProps<typeof ToolSettings> & { history?: ReactNode; view: ReactNode }) {
  const docked = (useStore((s) => s.ui.designerDock) ?? 'tools') === 'tools';
  const viewBar = <div className="designer-view" role="toolbar" aria-label="Canvas view" aria-orientation="vertical">
    {history ? <div className="view-history">{history}</div> : null}
    {view}
    <IconButton icon={docked ? PanelLeft : PanelBottom} label={docked ? 'Toolbox at the side' : 'Toolbox in the prompt box'} size="sm" onClick={() => setUi({ designerDock: docked ? 'prompt' : 'tools' })} />
  </div>;
  if (docked) return viewBar;
  return <div className="designer-side">
    <div className="designer-palette is-side">
      <ToolDock sessionId={settings.sessionId} doc={settings.doc} selectedCurve={settings.selectedCurve} vertical />
    </div>
    {viewBar}
  </div>;
}
