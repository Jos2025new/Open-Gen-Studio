import { createContext, useContext } from 'react';
import { useStore } from '../../store/store';

/** True when a panel (Sessions, Library) is shown as a section inside Home rather than as a drawer. */
export const PanelEmbed = createContext(false);

/** Embedded panels always use the full-view layout and never touch the drawer's own expanded state. */
export function usePanelExpanded(): { expanded: boolean; embedded: boolean } {
  const embedded = useContext(PanelEmbed);
  const stored = useStore((s) => s.ui.panelExpanded);
  return { expanded: embedded || stored, embedded };
}
