import { useStore } from '../../store/store';
import { editPresentation } from '../nodecore/edit';
import { settleFresh } from './graph-layout';

/** Moves the first-measured nodes that stack on their neighbours (see `settleFresh`). Writes the store without an undo step. */
export function settleNewNodes(sessionId: string, fresh: ReadonlySet<string>, measured: Map<string, { width: number; height: number }>): void {
  const nodes = useStore.getState().sessions[sessionId]?.graph.nodes;
  if (!nodes) return;
  const moved = settleFresh(nodes, fresh, measured);
  if (!moved.size) return;
  editPresentation(sessionId, (g) => ({ ...g, nodes: g.nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)) }), { silent: true });
}
