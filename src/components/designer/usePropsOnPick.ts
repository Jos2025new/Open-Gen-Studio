import { useEffect, useRef } from 'react';
import { useStore } from '../../store/store';

/**
 * With the Edit tool, a new, non-empty selection opens Properties when the Tool tab is showing; Layers stays (the user is
 * managing layers). Other tools keep their settings in view: choosing where to paint is not editing an object.
 */
export function usePropsOnPick(tab: string, setTab: (tab: string) => void, selected: string[]) {
  const editing = useStore((s) => s.ui.tool === 'move');
  const key = selected.join('|');
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    if (key && editing && tab === 'tool') setTab('props');
  }, [key, tab, setTab, editing]);
}
