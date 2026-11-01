import { useEffect, useRef } from 'react';
import { useStore } from '../../store/store';
import { useObjectSelection } from '../../engine/design/objectSelection';

/**
 * With the Edit tool, a new, non-empty selection opens Properties when the Tool tab is showing; Layers stays (the user is
 * managing layers). Other tools keep their settings in view: choosing where to paint is not editing an object.
 */
export function usePropsOnPick(tab: string, setTab: (tab: string) => void, selected: string[], docId: string) {
  const editing = useStore((s) => s.ui.tool === 'move');
  // A real pick: objects, or several layers. The active layer alone is always set (undo or a new layer changes it), so it is not one.
  const objects = useObjectSelection((st) => st.byDoc[docId]?.ids.join('|') ?? '');
  const key = objects || (selected.length > 1 ? selected.join('|') : '');
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    if (key && editing && tab === 'tool') setTab('props');
  }, [key, tab, setTab, editing]);
}
