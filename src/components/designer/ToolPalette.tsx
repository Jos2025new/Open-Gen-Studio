import { type ComponentProps, type ReactNode } from 'react';
import { create } from 'zustand';
import { GalleryVerticalEnd } from 'lucide-react';
import { announceSidePopup, ToolDock, useSidePopup } from './ToolDock';
import { ToolSettings } from './ToolSettings';
import { DocumentChoices } from './DocumentPicker';
import { useStore } from '../../store/store';
import { IconButton } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { CornerButtons, DesignerCorner } from '../node/NodeSide';

/** The bar at the bottom leaves this slot for the active tool's options; ToolDock fills it through a portal. */
const useDockSlot = create<{ el: HTMLElement | null }>(() => ({ el: null }));
const setDockSlot = (el: HTMLElement | null) => useDockSlot.setState({ el });
export function DockSlot() {
  return <div className="designer-dock-options tool-dock" ref={setDockSlot} />;
}

/** First button of the toolbox: the session's designs as a popup beside it (right of the toolbox); the picker in the corner is hidden then. */
function DesignsButton({ sessionId, active }: { sessionId: string; active: ComponentProps<typeof ToolSettings>['doc'] }) {
  const pop = usePopover();
  useSidePopup('designs', pop.close);
  const docs = useStore((s) => s.sessions[sessionId]?.docs) ?? [active];
  return <>
    <IconButton ref={pop.ref} icon={GalleryVerticalEnd} label={`Designs · ${active.name}`} size="md" aria-haspopup="listbox" aria-expanded={pop.open} active={pop.open} onClick={() => { if (!pop.open) announceSidePopup('designs'); pop.toggle(); }} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="right-start" align="start" width={212} label="Designs" className="designs-pop">
      <DocumentChoices sessionId={sessionId} docs={docs} active={active} />
    </Popover>
  </>;
}

/**
 * The toolbox: an upright strip at the left, with the designs, Create and Conversation on top (as in Nodes) and the canvas
 * view (zoom, fit, view toggles) under it in one frame. The active tool's options sit at the bottom, where the prompt box
 * sits when it is asked for.
 */
export function ToolPalette({ history, view, ...settings }: ComponentProps<typeof ToolSettings> & { history?: ReactNode; view: ReactNode }) {
  const slot = useDockSlot((s) => s.el);
  return <div className="designer-side">
    <DesignsButton sessionId={settings.sessionId} active={settings.doc} />
    <CornerButtons sessionId={settings.sessionId} space="designer" />
    <span className="tool-dock-separator" aria-hidden="true" />
    <div className="designer-palette is-side">
      <ToolDock sessionId={settings.sessionId} doc={settings.doc} selectedCurve={settings.selectedCurve} vertical designer optionsSlot={slot} />
    </div>
    <div className="designer-view" role="toolbar" aria-label="Canvas view" aria-orientation="vertical">
      {history ? <div className="view-history">{history}</div> : null}
      {view}
    </div>
    <DesignerCorner sessionId={settings.sessionId} />
  </div>;
}
