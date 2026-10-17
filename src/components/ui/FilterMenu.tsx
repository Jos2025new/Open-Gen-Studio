import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { MenuItem } from './primitives';
import { Popover, usePopover } from './Popover';

/** A small "Label ▾" chip in the filter row that opens a menu of choices. */
export function FilterMenu<T extends string>({ label, icon, value, options, onChange, active }: { label: string; icon?: ReactNode; value: T; options: Array<[T, ReactNode]>; onChange: (v: T) => void; active?: boolean }) {
  const pop = usePopover();
  return (
    <>
      <button ref={pop.ref} type="button" className={`ml-filter ${active ? 'is-active' : ''} ${pop.open ? 'is-open' : ''}`} onClick={pop.toggle} aria-haspopup="menu" aria-expanded={pop.open}>
        {icon}
        <span className="ml-filter-label">{label}</span>
        <ChevronDown size={12} />
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={200} label={label}>
        <div className="menu">
          {options.map(([id, text]) => (
            <MenuItem key={id} label={text} active={id === value} right={id === value ? <Check size={13} /> : null} onClick={() => { onChange(id); pop.close(); }} />
          ))}
        </div>
      </Popover>
    </>
  );
}
