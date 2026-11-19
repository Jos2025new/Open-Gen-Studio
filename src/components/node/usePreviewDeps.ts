import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/store';

/**
 * What a run preview (request and price) reads, and nothing else: a button that only shows a popover must not re-render on every
 * store change. While the preview is not shown it subscribes to nothing that changes.
 */
export function usePreviewDeps(sessionId: string, active: boolean): void {
  useStore(useShallow((s) => {
    if (!active) return [];
    const session = s.sessions[sessionId];
    return [session?.graph, session?.feed, s.generations, s.assets, s.library, s.catalog, s.composer.text];
  }));
}
