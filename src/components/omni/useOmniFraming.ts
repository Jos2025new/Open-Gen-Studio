import { useEffect } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import { useStore } from '../../store/store';

/** The omnicanvas opens framed on the session's main parts (Studio, Nodes, Designer, chat), never below 60 % zoom. */
export const OMNI_OPEN_MIN_ZOOM = 0.6;

export function useOmniFraming(omni: boolean, sessionId: string, rf: ReactFlowInstance): void {
  useEffect(() => {
    if (!omni) return;
    const t = window.setTimeout(() => {
      const main = useStore.getState().sessions[sessionId]?.graph.nodes.filter((n) => n.data.kind === 'ref' && (n.data.type === 'space' || n.data.type === 'chat')).map((n) => ({ id: n.id })) ?? [];
      if (main.length) void rf.fitView({ nodes: main, padding: 0.2, minZoom: OMNI_OPEN_MIN_ZOOM, maxZoom: 1, duration: 0 });
    }, 150);
    return () => window.clearTimeout(t);
    // Once per opening of the omnicanvas for a session: later changes do not re-frame the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [omni, sessionId]);
}
