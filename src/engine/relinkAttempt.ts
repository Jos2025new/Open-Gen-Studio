import { updateFeedItem } from '../store/store';
import { useStore } from '../store/store';
import { applyEdit } from './nodecore/edit';
import type { GenerationFeedItem, GraphNode, PlanFeedItem } from './types';

/** A retry made a new attempt: the node, the card and the plan step that showed the failed one show the new one. */
export function relinkAttempt(oldId: string, newId: string): void {
  for (const [sessionId, session] of Object.entries(useStore.getState().sessions)) {
    const nodes = session.graph?.nodes ?? [];
    if (nodes.some((n) => 'generationId' in n.data && n.data.generationId === oldId)) {
      for (const n of nodes) if ('generationId' in n.data && n.data.generationId === oldId) applyEdit({ session: sessionId, op: { op: 'set', node: n.id, patch: { generationId: newId } as Partial<GraphNode['data']> } });
    }
    for (const item of session.feed) {
      if (item.type === 'generation' && item.generationId === oldId) {
        updateFeedItem<GenerationFeedItem>(sessionId, item.id, { generationId: newId });
      } else if (item.type === 'plan' && Object.values(item.stepGenerations).includes(oldId)) {
        updateFeedItem<PlanFeedItem>(sessionId, item.id, (it) => ({
          ...it,
          stepGenerations: Object.fromEntries(Object.entries(it.stepGenerations).map(([step, gid]) => [step, gid === oldId ? newId : gid])),
        }));
      }
    }
  }
}
