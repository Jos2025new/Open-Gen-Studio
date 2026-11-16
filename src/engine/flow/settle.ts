import { useStore } from '../../store/store';
import { settleFresh } from './graph-layout';

/** Moves the first-measured nodes that stack on their neighbours (see `settleFresh`). Writes the store without an undo step. */
export function settleNewNodes(sessionId: string, fresh: ReadonlySet<string>, measured: Map<string, { width: number; height: number }>): void {
  const nodes = useStore.getState().sessions[sessionId]?.graph.nodes;
  if (!nodes) return;
  const moved = settleFresh(nodes, fresh, measured);
  if (!moved.size) return;
  useStore.setState((s) => {
    const cur = s.sessions[sessionId];
    if (!cur) return s;
    return { sessions: { ...s.sessions, [sessionId]: { ...cur, graph: { ...cur.graph, nodes: cur.graph.nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)) } } } };
  });
}
