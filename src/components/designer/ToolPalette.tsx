import { type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { GalleryVerticalEnd } from '../ui/icons';
import { announceSidePopup, ToolDock, useSidePopup } from './ToolDock';
import { ToolSettings } from './ToolSettings';
import { DocumentChoices } from './DocumentPicker';
import { useStore } from '../../store/store';
import { IconButton } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { CornerButtons, DesignerCorner } from '../node/NodeSide';

/**
 * The prompt dock leaves two slots: the bar takes the toolbox (Designs, Create and Conversation, the tools, the canvas view)
 * and `options` sits directly above it, where ToolDock puts the active tool's options. ToolPalette and ToolDock fill them through portals.
 */
const useDockSlot = create<{ bar: HTMLElement | null; options: HTMLElement | null }>(() => ({ bar: null, options: null }));
const setBarSlot = (el: HTMLElement | null) => useDockSlot.setState({ bar: el });
const setOptionsSlot = (el: HTMLElement | null) => useDockSlot.setState({ options: el });
export function DockSlot({ at }: { at: 'bar' | 'options' }) {
  return at === 'bar' ? <div className="designer-dock-bar" ref={setBarSlot} /> : <div className="designer-dock-options tool-dock" ref={setOptionsSlot} />;
}

/** First button of the toolbox: the session's designs as a popup beside it (right of the side toolbox, above the bar); the picker in the corner is hidden then. */
function DesignsButton({ sessionId, active, up = false }: { sessionId: string; active: ComponentProps<typeof ToolSettings>['doc']; up?: boolean }) {
  const pop = usePopover();
  useSidePopup('designs', pop.close);
  const docs = useStore((s) => s.sessions[sessionId]?.docs) ?? [active];
  return <>
    <IconButton ref={pop.ref} icon={GalleryVerticalEnd} label={`Designs · ${active.name}`} size="md" aria-haspopup="listbox" aria-expanded={pop.open} active={pop.open} onClick={() => { if (!pop.open) announceSidePopup('designs'); pop.toggle(); }} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement={up ? 'top-start' : 'right-start'} align="start" width={212} label="Designs" className={up ? 'designs-pop is-up' : 'designs-pop'}>
      <DocumentChoices sessionId={sessionId} docs={docs} active={active} />
    </Popover>
  </>;
}

/**
 * The toolbox: one row in the bar of the prompt dock, with the designs, Create and Conversation before the tools (as in Nodes)
 * and the canvas view (zoom, fit) after them; the popups open above the bar and the active tool's options sit directly above it.
 * Where the prompt box takes the bar (Conversation, a kind in Create), the same pieces stand upright at the side, so choosing a tool
 * there brings the bar back.
 */
export function ToolPalette({ history, view, ...settings }: ComponentProps<typeof ToolSettings> & { history?: ReactNode; view: ReactNode }) {
  const docked = (useStore((s) => s.ui.designerDock) ?? 'tools') === 'tools';
  const slot = useDockSlot();
  const viewBar = <div className="designer-view" role="toolbar" aria-label="Canvas view" aria-orientation={docked ? 'horizontal' : 'vertical'}>
    {history ? <div className="view-history">{history}</div> : null}
    {view}
  </div>;
  if (docked) return slot.bar && slot.options ? createPortal(<>
    <div className="designer-dock-start">
      <DesignsButton sessionId={settings.sessionId} active={settings.doc} up />
      <CornerButtons sessionId={settings.sessionId} space="designer" />
      <span className="tool-dock-separator" aria-hidden="true" />
      <DesignerCorner sessionId={settings.sessionId} />
    </div>
    <div className="designer-palette is-docked">
      <ToolDock sessionId={settings.sessionId} doc={settings.doc} selectedCurve={settings.selectedCurve} designer optionsSlot={slot.options} />
    </div>
    <div className="designer-dock-end"><span className="tool-dock-separator" aria-hidden="true" />{viewBar}</div>
  </>, slot.bar) : null;
  return <div className="designer-side">
    <DesignsButton sessionId={settings.sessionId} active={settings.doc} />
    <CornerButtons sessionId={settings.sessionId} space="designer" />
    <span className="tool-dock-separator" aria-hidden="true" />
    <div className="designer-palette is-side">
      <ToolDock sessionId={settings.sessionId} doc={settings.doc} selectedCurve={settings.selectedCurve} vertical />
    </div>
    {viewBar}
    <DesignerCorner sessionId={settings.sessionId} />
  </div>;
}
