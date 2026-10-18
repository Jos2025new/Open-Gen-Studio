import { useStore } from '../../store/store';
import type { PlanFeedItem } from '../types';

/**
 * What the agent is told about a failed step: the model that really ran (name and ref), its provider, where its
 * parameter schema came from, and the provider's own words. Without these the agent guessed a cause.
 */
export function failedStepSummary(sessionId: string, itemId: string, stepId: string, error: string): string {
  const st = useStore.getState();
  const item = st.sessions[sessionId]?.feed.find((f): f is PlanFeedItem => f.id === itemId && f.type === 'plan');
  const g = st.generations[item?.stepGenerations?.[stepId] ?? ''];
  if (!g) return `${stepId} failed (${error})`;
  const source = st.catalog.schemas[g.modelRef]?.source ?? 'not loaded';
  return `${stepId} failed. Model used: ${g.modelName} (${g.modelRef}), provider ${g.provider ?? g.modelRef.split('::')[0]}, parameter schema: ${source}. Provider error, verbatim: ${error}`;
}
