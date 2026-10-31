import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, EllipsisVertical, Search, X, type LucideIcon } from 'lucide-react';
import { Button, IconButton, Segmented, Toggle } from './primitives';
import { InlineSlider } from '../designer/InlineControls';
import { Popover, PopoverHeader, usePopover } from './Popover';
import './PanelControls.css';

/**
 * Search as an icon button at the start of a top bar. Pressing it shows the input beside it; Escape or the clear button
 * empties the query and hides it. While a query is set the icon stays active, so the filter is never invisible.
 */
export function SearchToggle({ value, onChange, placeholder, inputLabel, hint }: { value: string; onChange: (v: string) => void; placeholder: string; inputLabel: string; /** Shown in the tooltip, e.g. the result count. */ hint?: string }) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const close = () => { onChange(''); setOpen(false); };
  return <>
    <IconButton icon={Search} label="Search" size="sm" active={open || value !== ''} aria-pressed={open || value !== ''} aria-expanded={open} data-tip={['Search', value ? `“${value}”` : '', hint ?? ''].filter(Boolean).join(' · ')} onClick={() => setOpen(!open)} />
    {open ? (
      <div className="search-input pc-search">
        <Search size={14} />
        <input ref={input} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={inputLabel} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }} />
        <button type="button" aria-label="Clear search" onClick={close}><X size={13} /></button>
      </div>
    ) : null}
  </>;
}

export type SortKey = 'name' | 'date';
export interface SortState { by: SortKey; asc: boolean }
type SortChoice = 'newest' | 'oldest' | 'az' | 'za';
const SORT_STATE: Record<SortChoice, SortState> = { newest: { by: 'date', asc: false }, oldest: { by: 'date', asc: true }, az: { by: 'name', asc: true }, za: { by: 'name', asc: false } };
/** None of the four when the list is sorted by another column (model, aspect…) from its header. */
const sortChoice = (s: { by: string; asc: boolean }): SortChoice | undefined => (s.by === 'date' ? (s.asc ? 'oldest' : 'newest') : s.by === 'name' ? (s.asc ? 'az' : 'za') : undefined);

/** Sort choices of the View popover: Newest / Oldest / A–Z / Z–A over the same SortState; `nameOnly` drops the two date choices. */
export function SortSegmented({ sort, onChange, nameOnly }: { sort: { by: string; asc: boolean }; onChange: (s: SortState) => void; nameOnly?: boolean }) {
  const options: Array<{ value: SortChoice; label: string }> = [...(nameOnly ? [] : [{ value: 'newest' as const, label: 'Newest' }, { value: 'oldest' as const, label: 'Oldest' }]), { value: 'az', label: 'A–Z' }, { value: 'za', label: 'Z–A' }];
  return <Segmented value={sortChoice(sort) as SortChoice} size="sm" onChange={(v) => onChange(SORT_STATE[v])} options={options} />;
}

export type ItemView = 'list' | 'card';
/** Stored values from older versions ('cards', 'grid') mean card view. */
export const asItemView = (v: unknown): ItemView => (v === 'list' ? 'list' : 'card');
export function LayoutSegmented({ value, onChange }: { value: ItemView; onChange: (v: ItemView) => void }) {
  return <Segmented value={value} size="sm" onChange={onChange} options={[{ value: 'card', label: 'Grid' }, { value: 'list', label: 'List' }]} />;
}

/** The grid-size slider of the View popover, as in Generations. */
export function GridSizeSlider({ cols, setCols, expanded }: { cols: number; setCols: (c: number) => void; expanded: boolean }) {
  return <InlineSlider label="Grid size" value={(expanded ? 10 : 7) - cols} min={2} max={expanded ? 8 : 5} onChange={(value) => setCols((expanded ? 10 : 7) - value)} />;
}

/** A titled row of the View and Filters popovers: a label and a switch, with an optional count. */
export function ToggleRow({ label, checked, onChange, count }: { label: string; checked: boolean; onChange: (v: boolean) => void; count?: number }) {
  return <label className="sv-switch"><span>{label}{count !== undefined ? <span className="faint num"> · {count}</span> : null}</span><Toggle checked={checked} onChange={onChange} label={label} /></label>;
}

/** One icon per intent (View, Filters): opens a small titled popover under it; `dot` marks that something inside is on. */
export function PanelPopover({ icon, label, dot, width = 280, children }: { icon: LucideIcon; label: string; dot?: boolean; width?: number; children: ReactNode | ((close: () => void) => ReactNode) }) {
  const pop = usePopover();
  return <span className="pc-pop">
    <IconButton ref={pop.ref} icon={icon} label={dot ? `${label} (active)` : label} size="sm" active={pop.open || dot} aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle} />
    {dot ? <i className="pc-dot" aria-hidden="true" /> : null}
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={width} placement="bottom-start" align="end" className="results-popover" label={label}>
      <PopoverHeader title={label} />
      <div className="sessions-view">{typeof children === 'function' ? children(pop.close) : children}</div>
    </Popover>
  </span>;
}

export interface RailItem<T extends string> { id: T; label: string; icon: LucideIcon; count?: number }
/** The source selector at the start of a bar: a pill with the current source (icon, label, chevron) that opens a menu of all of them. */
/** `allLabel` names the first source on the button (the panel's own name, as Generations titles its board). */
export function SourceSelect<T extends string>({ items, value, onChange, label, separatorAfter, allLabel }: { items: RailItem<T>[]; value: T; onChange: (v: T) => void; label: string; separatorAfter?: T; allLabel?: string }) {
  const pop = usePopover();
  const cur = items.find((i) => i.id === value) ?? items[0];
  const Icon = cur.icon;
  const shown = allLabel && cur.id === items[0].id ? allLabel : cur.label;
  return <>
    <button ref={pop.ref} type="button" className="canvas-tab is-on pc-source" aria-label={`${label}: ${shown}`} aria-haspopup="menu" aria-expanded={pop.open} onClick={pop.toggle}>
      <Icon size={14} strokeWidth={1.75} />{shown}<ChevronDown size={12} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={220} placement="bottom-start" align="start" label={label}>
      <div className="pc-menu" role="menu">
        {items.map((i) => <Fragment key={i.id}>
          <MenuItem icon={i.icon} selected={i.id === value} onClick={() => { onChange(i.id); pop.close(); }}>{i.label}{i.count !== undefined ? <span className="pc-count num">{i.count}</span> : null}</MenuItem>
          {i.id === separatorAfter ? <hr className="pc-menu-sep" /> : null}
        </Fragment>)}
      </div>
    </Popover>
  </>;
}

/**
 * Mouse and keyboard open a card on one click; a finger taps once to reveal the overlay and again to open.
 * Tapping anywhere else hides it. The card must carry the `is-armed` class this returns.
 */
export function useTapReveal(open: () => void) {
  const [armed, setArmed] = useState(false);
  const touch = useRef(false);
  useEffect(() => {
    if (!armed) return;
    const away = (e: Event) => { if (!(e.target as Element | null)?.closest?.('.is-armed')) setArmed(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [armed]);
  return {
    armed,
    onPointerDown: (e: { pointerType?: string }) => { touch.current = e.pointerType === 'touch'; },
    onClick: () => {
      const tapped = touch.current;
      touch.current = false;
      if (tapped && !armed) setArmed(true);
      else { setArmed(false); open(); }
    },
  };
}

/** Square checkbox shown over a card; stays visible while checked or while any card is being selected. */
export function CardCheck({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className={`pc-check pc-hover${checked ? ' is-on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle(); }} onDoubleClick={(e) => e.stopPropagation()}>
    <span className="pc-box">{checked ? <Check size={13} strokeWidth={2.75} /> : null}</span>
  </button>;
}

/** Checkbox in a group header (a date or a session): selects or clears every item of the group; mixed when only some are. */
export function GroupCheck({ label, state, onToggle }: { label: string; state: 'all' | 'some' | 'none'; onToggle: () => void }) {
  return <button type="button" role="checkbox" aria-label={`Select ${label}`} aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false} className={`pc-group-check${state === 'all' ? ' is-on' : ''}${state === 'some' ? ' is-mixed' : ''}`} onClick={onToggle}>
    {state === 'all' ? <Check size={12} strokeWidth={2.75} /> : state === 'some' ? <span className="pc-dash" /> : null}
  </button>;
}

export function MenuItem({ icon: Icon, children, tone, disabled, selected, onClick }: { icon?: LucideIcon; children: ReactNode; tone?: 'danger'; disabled?: boolean; /** Marks the current choice of a menu of sources. */ selected?: boolean; onClick: () => void }) {
  return <button type="button" role="menuitem" aria-current={selected ? 'true' : undefined} className={`pc-menu-item${tone ? ` tone-${tone}` : ''}${selected ? ' is-on' : ''}`} disabled={disabled} onClick={onClick}>{Icon ? <Icon size={16} strokeWidth={1.75} /> : null}{children}</button>;
}

/** Evaluates a render function only while the menu is open, so closed cards pay nothing for their menu items. */
function Lazy({ render }: { render: () => ReactNode }) { return <>{render()}</>; }

/** The ⋮ button of a card or row and the popover with its secondary actions; it opens outward from the button, not over the card. */
export function CardMenu({ label, children, className }: { label: string; className?: string; children: (close: () => void) => ReactNode }) {
  const pop = usePopover();
  return <>
    <IconButton ref={pop.ref} icon={EllipsisVertical} label={label} size="sm" className={`pc-more ${className ?? ''}`} aria-haspopup="menu" aria-expanded={pop.open} active={pop.open} onClick={(e) => { e.stopPropagation(); pop.toggle(); }} onDoubleClick={(e) => e.stopPropagation()} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={236} placement="bottom-start" align="start" edge="slide" className="pc-menu-pop" label={label}>
      <div className="pc-menu" role="menu"><Lazy render={() => children(pop.close)} /></div>
    </Popover>
  </>;
}

/** A confirmation shown inside a card menu: it names the consequence and always offers Cancel. */
export function MenuConfirm({ text, action, onCancel, onConfirm, extra }: { text: string; action: string; onCancel: () => void; onConfirm: () => void; extra?: ReactNode }) {
  return <div className="confirm"><p>{text}</p>{extra}<div className="spend-actions">
    <Button variant="ghost" onClick={onCancel}>Cancel</Button>
    <Button variant="danger" onClick={onConfirm}>{action}</Button>
  </div></div>;
}
