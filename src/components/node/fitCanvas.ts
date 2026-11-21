import type { ReactFlowInstance } from '@xyflow/react';
import { fitTargets, type FitScope } from '../../engine/flow/fitTargets';
import { useStore } from '../../store/store';

/** Shift+1 fits everything (without system cards), Shift+2 the selection; the toolbox button does the selection when there is one. Returns whether it framed anything. */
export function fitCanvas(rf: Pick<ReactFlowInstance, 'getNodes' | 'fitView'>, sessionId: string, selected: Iterable<string>, scope: FitScope = 'auto'): boolean {
  const graph = useStore.getState().sessions[sessionId]?.graph;
  if (!graph) return false;
  const shown = new Set(rf.getNodes().filter((n) => !n.hidden).map((n) => n.id));
  const ids = fitTargets(graph.nodes.filter((n) => shown.has(n.id)), selected, scope);
  if (!ids.length) return false;
  void rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.2, maxZoom: 1, duration: 300 });
  return true;
}
