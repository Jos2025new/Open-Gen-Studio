import type { ComponentProps, ReactNode } from 'react';
import { ToolRail } from './ToolRail';
import { ToolSettings } from './ToolSettings';

export function ToolPalette({ history, view, ...settings }: ComponentProps<typeof ToolSettings> & { history: ReactNode; view: ReactNode }) {
  return <>
    <div className="designer-palette">
      <ToolRail sessionId={settings.sessionId} doc={settings.doc} />
    </div>
    <div className="designer-view" role="toolbar" aria-label="Canvas view" aria-orientation="vertical">
      <div className="view-history">{history}</div>
      {view}
    </div>

  </>;
}
