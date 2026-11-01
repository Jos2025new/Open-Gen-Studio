import { type ComponentProps, type ReactNode } from 'react';
import { GalleryVerticalEnd, PanelBottom, PanelLeft } from 'lucide-react';
import { ToolDock } from './ToolDock';
import { ToolSettings } from './ToolSettings';
import { DocumentChoices } from './DocumentPicker';
import { setUi, useStore } from '../../store/store';
import { IconButton } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { CornerButtons, DesignerCorner } from '../node/NodeSide';

/** Last button of the toolbox, in both places: moves it between the prompt box and the side. */
export function DockPlaceButton() {
  const docked = (useStore((s) => s.ui.designerDock) ?? 'tools') === 'tools';
  return <IconButton icon={docked ? PanelLeft : PanelBottom} label={docked ? 'Toolbox at the side' : 'Toolbox in the prompt box'} size="md" onClick={() => setUi({ designerDock: docked ? 'prompt' : 'tools' })} />;
}

/** Side toolbox, first button: the session's designs as a popup at its right (the picker in the corner is hidden then). */
function DesignsButton({ sessionId, active }: { sessionId: string; active: ComponentProps<typeof ToolSettings>['doc'] }) {
  const pop = usePopover();
  const docs = useStore((s) => s.sessions[sessionId]?.docs) ?? [active];
  return <>
    <IconButton ref={pop.ref} icon={GalleryVerticalEnd} label={`Designs · ${active.name}`} size="md" aria-haspopup="listbox" aria-expanded={pop.open} active={pop.open} onClick={pop.toggle} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="right-start" width={212} label="Designs" className="designs-pop">
      <DocumentChoices sessionId={sessionId} docs={docs} active={active} />
    </Popover>
  </>;
}

/**
 * The toolbox outside the prompt box: the same strip as in the composer, turned upright at the left, with the designs,
 * Create and Conversation on top (as in Nodes) and the canvas view (zoom, fit, view toggles) under it in one frame. With the toolbox in the composer, the view
 * stays on its own.
 */
export function ToolPalette({ history, view, ...settings }: ComponentProps<typeof ToolSettings> & { history?: ReactNode; view: ReactNode }) {
  const docked = (useStore((s) => s.ui.designerDock) ?? 'tools') === 'tools';
  const viewBar = <div className="designer-view" role="toolbar" aria-label="Canvas view" aria-orientation="vertical">
    {history ? <div className="view-history">{history}</div> : null}
    {view}
  </div>;
  if (docked) return viewBar;
  return <div className="designer-side">
    <DesignsButton sessionId={settings.sessionId} active={settings.doc} />
    <CornerButtons sessionId={settings.sessionId} space="designer" />
    <span className="tool-dock-separator" aria-hidden="true" />
    <div className="designer-palette is-side">
      <ToolDock sessionId={settings.sessionId} doc={settings.doc} selectedCurve={settings.selectedCurve} vertical place={<DockPlaceButton />} />
    </div>
    {viewBar}
    <DesignerCorner sessionId={settings.sessionId} />
  </div>;
}
