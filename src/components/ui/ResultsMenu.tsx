import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Popover, usePopover } from './Popover';
import './ResultsMenu.css';

/** A compact, independently anchored control for an existing results option. */
export function ResultsMenu({ label, icon: Icon, iconOnly = false, active = false, width = 240, children }: { label: string; icon?: LucideIcon; iconOnly?: boolean; active?: boolean; width?: number; children: ReactNode }) {
  const pop = usePopover();
  return <>
    <button ref={pop.ref} type="button" className={`results-menu-trigger${active ? ' is-active' : ''}`} onClick={pop.toggle} aria-label={label} aria-haspopup="dialog" aria-expanded={pop.open}>
      {Icon ? <Icon size={14} /> : null}{iconOnly ? null : label}<ChevronDown size={12} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={width} className="results-popover" label={label}>
      <div className="sessions-view">{children}</div>
    </Popover>
  </>;
}
