import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownAZ, Search, X, ArrowUpZA, CalendarArrowDown, CalendarArrowUp, Check, EllipsisVertical, LayoutGrid, List, type LucideIcon } from 'lucide-react';
import { Button, IconButton } from './primitives';
import { Popover, usePopover } from './Popover';
import './PanelControls.css';

/**
 * Search as an icon button at the start of a top bar. Pressing it shows the input beside it; Escape or the clear button
 * empties the query and hides it. While a query is set the icon stays active, so the filter is never invisible.
 */
export function SearchToggle({ value, onChange, placeholder, inputLabel }: { value: string; onChange: (v: string) => void; placeholder: string; inputLabel: string }) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const close = () => { onChange(''); setOpen(false); };
  return <>
    <IconButton icon={Search} label="Search" size="sm" active={open || value !== ''} aria-pressed={open || value !== ''} aria-expanded={open} data-tip={value ? `Search · “${value}”` : 'Search'} onClick={() => setOpen(!open)} />
    {open ? (
      <div className="search-input pc-search">
        <Search size={14} />
        <input ref={input} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={inputLabel} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }} />
        <button type="button" aria-label="Clear search" onClick={close}><X size={13} /></button>
      </div>
    ) : null}
  </>;
}

/** Thin vertical line between groups of controls in a panel's top bar. */
export function Sep() { return <span className="pc-sep" role="separator" aria-orientation="vertical" />; }

export type SortKey = 'name' | 'date';
export interface SortState { by: SortKey; asc: boolean }
/** Date starts newest first, name starts A → Z; pressing the active key flips it, pressing the other makes it the only active order. */
export function nextSort(cur: SortState, key: SortKey): SortState {
  return cur.by === key ? { by: key, asc: !cur.asc } : { by: key, asc: key === 'name' };
}

/** Two icon-only toggles: sort by name and sort by date. Only one is active at a time. */
export function SortToggles({ sort, onChange, nameTip = 'A → Z', nameTipDesc = 'Z → A', dateTip = 'Oldest first', dateTipDesc = 'Newest first' }: { sort: SortState; onChange: (s: SortState) => void; nameTip?: string; nameTipDesc?: string; dateTip?: string; dateTipDesc?: string }) {
  const name = sort.by === 'name';
  const date = sort.by === 'date';
  const NameIcon: LucideIcon = name && !sort.asc ? ArrowUpZA : ArrowDownAZ;
  const DateIcon: LucideIcon = date && sort.asc ? CalendarArrowUp : CalendarArrowDown;
  return <>
    <IconButton icon={NameIcon} label="Sort by name" size="sm" active={name} aria-pressed={name} data-tip={`Sort by name · ${name && !sort.asc ? nameTipDesc : nameTip}`} onClick={() => onChange(nextSort(sort, 'name'))} />
    <IconButton icon={DateIcon} label="Sort by date" size="sm" active={date} aria-pressed={date} data-tip={`Sort by date · ${date && sort.asc ? dateTip : dateTipDesc}`} onClick={() => onChange(nextSort(sort, 'date'))} />
  </>;
}

export type ItemView = 'list' | 'card';
/** Stored values from older versions ('cards', 'grid') mean card view. */
export const asItemView = (v: unknown): ItemView => (v === 'list' ? 'list' : 'card');
export function ViewToggle({ value, onChange }: { value: ItemView; onChange: (v: ItemView) => void }) {
  return <div className="pc-group" role="group" aria-label="View">
    <IconButton icon={List} label="List view" size="sm" active={value === 'list'} aria-pressed={value === 'list'} onClick={() => onChange('list')} />
    <IconButton icon={LayoutGrid} label="Card view" size="sm" active={value === 'card'} aria-pressed={value === 'card'} onClick={() => onChange('card')} />
  </div>;
}

export interface RailItem<T extends string> { id: T; label: string; icon: LucideIcon; count?: number }
/** Vertical list of categories: icon + text when expanded, an icon-only rail (labels as tooltips) when not. */
export function CategoryRail<T extends string>({ items, value, onChange, expanded, label }: { items: RailItem<T>[]; value: T; onChange: (v: T) => void; expanded: boolean; label: string }) {
  return <nav className={`pc-rail${expanded ? '' : ' is-icons'}`} aria-label={label}>
    {items.map(({ id, label: text, icon: Icon, count }) => (
      <button key={id} type="button" className={`pc-rail-item${value === id ? ' is-on' : ''}`} aria-label={text} aria-current={value === id ? 'true' : undefined} data-tip={expanded ? undefined : text} data-tip-side="right" onClick={() => onChange(id)}>
        <Icon size={15} strokeWidth={1.75} />{expanded ? <span>{text}</span> : null}{expanded && count !== undefined ? <span className="pc-count num">{count}</span> : null}
      </button>
    ))}
  </nav>;
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

export function MenuItem({ icon: Icon, children, tone, disabled, onClick }: { icon?: LucideIcon; children: ReactNode; tone?: 'danger'; disabled?: boolean; onClick: () => void }) {
  return <button type="button" role="menuitem" className={`pc-menu-item${tone ? ` tone-${tone}` : ''}`} disabled={disabled} onClick={onClick}>{Icon ? <Icon size={14} strokeWidth={1.75} /> : null}{children}</button>;
}

/** Evaluates a render function only while the menu is open, so closed cards pay nothing for their menu items. */
function Lazy({ render }: { render: () => ReactNode }) { return <>{render()}</>; }

/** The ⋮ button of a card or row and the popover with its secondary actions. */
export function CardMenu({ label, children, className }: { label: string; className?: string; children: (close: () => void) => ReactNode }) {
  const pop = usePopover();
  return <>
    <IconButton ref={pop.ref} icon={EllipsisVertical} label={label} size="sm" className={`pc-more ${className ?? ''}`} aria-haspopup="menu" aria-expanded={pop.open} active={pop.open} onClick={(e) => { e.stopPropagation(); pop.toggle(); }} onDoubleClick={(e) => e.stopPropagation()} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={220} placement="bottom-start" label={label}>
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
