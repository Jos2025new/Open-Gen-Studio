import { type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { GalleryVerticalEnd, PanelBottom, PanelLeft } from 'lucide-react';
import { announceSidePopup, ToolDock, useSidePopup } from './ToolDock';
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

/**
 * The toolbox in the prompt box carries what the side toolbox carries: Designs, Create and Conversation before the
 * tools, the canvas view after them. The bar leaves two slots; ToolPalette fills them through portals.
 */
const useDockSlot = create<{ start: HTMLElement | null; end: HTMLElement | null }>(() => ({ start: null, end: null }));
export function DockSlot({ at }: { at: 'start' | 'end' }) {
  return <div className={`designer-dock-${at}`} ref={(el) => useDockSlot.setState({ [at]: el })} />;
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
 * The toolbox outside the prompt box: the same strip as in the composer, turned upright at the left, with the designs,
 * Create and Conversation on top (as in Nodes) and the canvas view (zoom, fit, view toggles) under it in one frame. In the
 * prompt box the same pieces sit before and after the tools, and their popups open above the bar.
 */
export function ToolPalette({ history, view, ...settings }: ComponentProps<typeof ToolSettings> & { history?: ReactNode; view: ReactNode }) {
  const docked = (useStore((s) => s.ui.designerDock) ?? 'tools') === 'tools';
  const slot = useDockSlot();
  const viewBar = <div className="designer-view" role="toolbar" aria-label="Canvas view" aria-orientation={docked ? 'horizontal' : 'vertical'}>
    {history ? <div className="view-history">{history}</div> : null}
    {view}
  </div>;
  if (docked) return slot.start && slot.end ? <>
    {createPortal(<>
      <DesignsButton sessionId={settings.sessionId} active={settings.doc} up />
      <CornerButtons sessionId={settings.sessionId} space="designer" />
      <span className="tool-dock-separator" aria-hidden="true" />
      <DesignerCorner sessionId={settings.sessionId} />
    </>, slot.start)}
    {createPortal(<><span className="tool-dock-separator" aria-hidden="true" />{viewBar}</>, slot.end)}
  </> : viewBar;
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
