import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical,
  AlignVerticalDistributeCenter, ArrowDownFromLine, ArrowLeftFromLine,
  ArrowRightFromLine, ArrowUpFromLine, Maximize, Minimize,
  type LucideIcon,
} from 'lucide-react';
import type { AlignTo, RelativeTo } from '../../engine/design/transform';

const HORIZONTAL: Array<{ id: AlignTo; label: string; icon: LucideIcon; reason?: 'anchor' }> = [
  { id: 'left', label: 'Align left', icon: AlignStartVertical },
  { id: 'center', label: 'Center horizontally', icon: AlignCenterVertical },
  { id: 'right', label: 'Align right', icon: AlignEndVertical },
  { id: 'left-to-right', label: 'Align left edge to anchor’s right edge', icon: ArrowRightFromLine, reason: 'anchor' },
  { id: 'right-to-left', label: 'Align right edge to anchor’s left edge', icon: ArrowLeftFromLine, reason: 'anchor' },
];
const VERTICAL: Array<{ id: AlignTo; label: string; icon: LucideIcon; reason?: 'anchor' }> = [
  { id: 'top', label: 'Align top', icon: AlignStartHorizontal },
  { id: 'middle', label: 'Center vertically', icon: AlignCenterHorizontal },
  { id: 'bottom', label: 'Align bottom', icon: AlignEndHorizontal },
  { id: 'top-to-bottom', label: 'Align top edge to anchor’s bottom edge', icon: ArrowDownFromLine, reason: 'anchor' },
  { id: 'bottom-to-top', label: 'Align bottom edge to anchor’s top edge', icon: ArrowUpFromLine, reason: 'anchor' },
];
const RELATIVE: Array<{ value: RelativeTo; label: string }> = [
  { value: 'page', label: 'Page' }, { value: 'selection', label: 'Selection' },
  { value: 'first', label: 'First selected' }, { value: 'last', label: 'Last selected' },
  { value: 'biggest', label: 'Biggest' }, { value: 'smallest', label: 'Smallest' },
];

function Action({ icon: Icon, label, reason, onClick }: { icon: LucideIcon; label: string; reason?: string; onClick: () => void }) {
  return <button type="button" className="align-action" aria-label={label} aria-disabled={Boolean(reason)} data-tip={reason ?? label}
    onClick={() => { if (!reason) onClick(); }}>
    <Icon size={16} strokeWidth={1.8} />
  </button>;
}

export function AlignPopover({
  target, count, relativeTo, setRelativeTo, alignAsGroup, setAlignAsGroup,
  groupReason, alignReason, anchorEdgeNeedsPair, onAlign, onDistribute, onFit, onFill,
}: {
  target: string; count: number; relativeTo: RelativeTo; setRelativeTo: (value: RelativeTo) => void;
  alignAsGroup: boolean; setAlignAsGroup: (value: boolean) => void; groupReason?: string;
  alignReason?: string; anchorEdgeNeedsPair: boolean; onAlign: (to: AlignTo) => void;
  onDistribute: (axis: 'h' | 'v') => void; onFit?: () => void; onFill?: () => void;
}) {
  const anchorReason = anchorEdgeNeedsPair ? 'Choose an anchor from at least two selected objects or layers.' : undefined;
  const reasonFor = (item: typeof HORIZONTAL[number]) => alignReason ?? (item.reason ? anchorReason : undefined);
  return <div className="align-popover">
    <div className="menu-target">{target}</div>
    <div className="align-options">
      <label className="align-reference"><span>Relative to</span><select aria-label="Relative to" value={relativeTo} onChange={(e) => setRelativeTo(e.target.value as RelativeTo)}>
        {RELATIVE.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select></label>
      <label className="align-group-option" data-tip={groupReason ?? 'Move selected objects together, keeping their spacing; the reference stays fixed.'}>
        <input type="checkbox" aria-label="Move or align selection as group" checked={alignAsGroup}
          disabled={count < 2 || (relativeTo === 'selection' && !alignAsGroup)} onChange={(e) => setAlignAsGroup(e.target.checked)} />
        <span>As group</span>
      </label>
    </div>
    <div className="align-actions" role="group" aria-label="Align selection">
      {[HORIZONTAL, VERTICAL].map((row, index) => <div className="align-action-row" key={index}>
        {row.map((item) => <Action key={item.id} icon={item.icon} label={item.label} reason={reasonFor(item)} onClick={() => onAlign(item.id)} />)}
      </div>)}
    </div>
    <div className="align-distribute" role="group" aria-label="Distribute selection">
      <Action icon={AlignHorizontalDistributeCenter} label="Even horizontal gaps" reason={count < 3 ? 'Select at least three objects or layers to distribute gaps.' : undefined} onClick={() => onDistribute('h')} />
      <Action icon={AlignVerticalDistributeCenter} label="Even vertical gaps" reason={count < 3 ? 'Select at least three objects or layers to distribute gaps.' : undefined} onClick={() => onDistribute('v')} />
    </div>
    {onFit && onFill && <div className="align-size">
      <button type="button" className="menu-item" onClick={onFit}><Minimize size={15} /><span>Fit inside page</span></button>
      <button type="button" className="menu-item" onClick={onFill}><Maximize size={15} /><span>Fill page</span></button>
    </div>}
  </div>;
}
