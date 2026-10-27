import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, usePopover } from '../ui/Popover';

/** A setting chip (icon + value) that opens its choices in a popover rising directly above it. */
export function ChipPop({ icon, label, tip, width = 320, children }: { icon: ReactNode; label: ReactNode; tip: string; width?: number; children: ReactNode }) {
  const pop = usePopover();
  // The plan card's popovers size to their content (a portal, so CSS cannot reach them through the card).
  const onPlan = pop.ref.current?.closest('.plan-card') != null;
  return (
    <>
      <button ref={pop.ref} type="button" className={`cc-chip${pop.open ? ' is-open' : ''}`} aria-haspopup="dialog" aria-expanded={pop.open} aria-label={tip} data-tip={pop.open ? undefined : tip} onClick={pop.toggle}>
        {icon}
        <span className="cc-chip-label">{label}</span>
        <ChevronDown size={11} className="cc-chip-chev" aria-hidden />
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={width} placement="top-center" label={tip} className={`cc-pop${onPlan ? ' cc-pop-plan' : ''}`}>
        {children}
      </Popover>
    </>
  );
}
