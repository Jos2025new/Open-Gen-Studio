import { updateFeedItem, useStore } from '../store/store';
import { toast } from '../store/toasts';
import { overLimit, overLimitText } from './budget';
import { attemptNode, holdAttemptNode } from './flow/locks';
import { applyEdit } from './nodecore/edit';
import { estimateForRetry } from './retryPartial';
import { SchemaUnavailableError, schemaUnavailableMessage } from './schemaGuard';
import type { Generation, GenerationFeedItem, GraphNode, PlanFeedItem } from './types';

export function newerAttempt(g: Generation, nodeId?: string): boolean {
  const operationId = g.operationId ?? g.id;
  let afterOriginal = false;
  return Object.values(useStore.getState().generations).some((other) => {
    if (other.id === g.id) { afterOriginal = true; return false; }
    if (other.sessionId !== g.sessionId) return false;
    if (other.parentId === g.id) return true;
    // A Run starts a new operation. In the same millisecond, insertion order breaks the tie.
    if (other.createdAt < g.createdAt || (other.createdAt === g.createdAt && !afterOriginal)) return false;
    return (other.operationId ?? other.id) === operationId ||
      Boolean(nodeId && other.origin === 'node' && other.stepId === nodeId);
  });
}

/** The plan claims its steps only after checking the aggregate price. Standalone Retry checks its own price. */
export function holdRetry(g: Generation, planItemId?: string): ReturnType<typeof holdAttemptNode> | SchemaUnavailableError {
  const session = useStore.getState().sessions[g.sessionId];
  if (g.planId) {
    const item = session?.feed.find((f) => f.id === planItemId);
    if (item?.type !== 'plan' || item.plan.id !== g.planId || item.status !== 'running' ||
      !g.stepId || item.stepStates[g.stepId] !== 'running' || item.stepGenerations[g.stepId] !== g.id) {
      toast('Use Retry on the plan to run this step.', 'info');
      return;
    }
  } else {
    const estimate = estimateForRetry(g);
    if (overLimit(estimate, g.sessionId)) {
      // An approval cannot make a derived schema sendable. Report the known refusal before asking about price.
      const { models, schemas } = useStore.getState().catalog;
      const model = models[g.modelRef];
      const schema = schemas[g.modelRef];
      if (model && schema?.source === 'derived') {
        return new SchemaUnavailableError(schemaUnavailableMessage(model, g.modelRef, schema.loadError));
      }
      toast(overLimitText(estimate), 'info');
      return;
    }
  }
  const nodes = session?.graph.nodes ?? [];
  const nodeId = g.origin === 'node' ? g.stepId ?? attemptNode(g, nodes)?.id : undefined;
  if (newerAttempt(g, nodeId)) return;
  return holdAttemptNode(g, nodes);
}

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
