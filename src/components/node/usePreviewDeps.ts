import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/store';
import { sessionChatText } from '../../engine/nodecore/resolver';

/**
 * What a run preview (request and price) reads, and nothing else: a button that only shows a popover must not re-render on every
 * store change. While the preview is not shown it subscribes to nothing that changes.
 */
export function usePreviewDeps(sessionId: string, active: boolean): void {
  useStore(useShallow((s) => {
    if (!active) return [];
    const session = s.sessions[sessionId];
    // The chat and the composer reach a preview only as the text a node reads from them: that text, not every streamed token or keystroke.
    const reads = (session?.graph.nodes ?? []).filter((n) => n.data.kind === 'ref' && (n.data.type === 'chat' || n.data.type === 'agent' || n.data.type === 'prompt')).map(sessionChatText);
    return [session?.graph, ...reads, s.generations, s.assets, s.library, s.catalog];
  }));
}
