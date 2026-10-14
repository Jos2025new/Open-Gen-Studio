import { ChevronDown, Magnet } from 'lucide-react';
import { snapOptsFor } from '../../engine/design/snap';
import { activeDoc } from '../../engine/design/actions';
import { paintModeOf } from '../../engine/design/paintMode';
import { setUi, useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';

export function SnapControl() {
  const pop = usePopover();
  const sid = useStore((s) => s.activeSessionId);
  const doc = activeDoc(sid) ?? { layers: [], paintMode: undefined };
  const byMode = useStore((s) => s.ui.snapByMode);
  const snap = snapOptsFor(doc as never, byMode);
  // The switch changes only the mode in use; the other mode keeps its own default.
  const set = (patch: Partial<typeof snap>) => setUi({ snapByMode: { ...byMode, [paintModeOf(doc as never)]: { ...snap, ...patch } } });
  return <>
    <button type="button" ref={pop.ref} className={`tool-setting ${snap.on ? 'is-on' : ''}`} aria-expanded={pop.open} onClick={pop.toggle} data-tip={`Snap while moving · ${snap.on ? "on" : "off"}`} aria-label="Snap"><Magnet size={14} /><ChevronDown size={12} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={220} label="Snap">
      <div className="snap-pop">
        <label className="check-row"><input type="checkbox" checked={snap.on} onChange={(e) => set({ on: e.target.checked })} />Snap while moving</label>
        <label className="check-row is-sub"><input type="checkbox" disabled={!snap.on} checked={snap.page} onChange={(e) => set({ page: e.target.checked })} />Page edges and center</label>
        <label className="check-row is-sub"><input type="checkbox" disabled={!snap.on} checked={snap.layers} onChange={(e) => set({ layers: e.target.checked })} />Other layers</label>
        <label className="check-row is-sub"><input type="checkbox" disabled={!snap.on} checked={snap.guides !== false} onChange={(e) => set({ guides: e.target.checked })} />Guides</label>
        <label className="check-row is-sub"><input type="checkbox" disabled={!snap.on} checked={snap.equalSpacing !== false} onChange={(e) => set({ equalSpacing: e.target.checked })} />Equal spacing</label>
        <label className="check-row is-sub"><input type="checkbox" disabled={!snap.on} checked={snap.nodes !== false} onChange={(e) => set({ nodes: e.target.checked })} />Path nodes</label>
        <p className="faint">Hold Alt while dragging to move freely.</p>
      </div>
    </Popover>
  </>;
}
