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
  const delivered = g.assetIds ?? [];
  const retryTotal = (g as typeof g & { retryTotal?: number }).retryTotal;
  const total = Number.isFinite(retryTotal) && retryTotal! >= 0
    ? retryTotal
    : Number.isFinite(g.settings?.count) || g.variants !== undefined
      ? Math.max(delivered.length, g.settings?.count ?? 0, g.variants?.length ?? 0)
      : undefined;
  const remaining = total === undefined ? undefined : Math.max(0, total - delivered.length);
  const delivery = total !== undefined
    ? `\nDelivery: ${delivered.length} of ${total} results arrived before failure. Delivered asset IDs: ${delivered.length ? delivered.join(', ') : 'none'}.${remaining ? ` ${remaining} result${remaining === 1 ? ' remains' : 's remain'} undelivered.` : ''}`
    : delivered.length
      ? `\nDelivery: ${delivered.length} result${delivered.length === 1 ? '' : 's'} arrived before failure. Delivered asset IDs: ${delivered.join(', ')}.`
      : '';
  const policyBlock = /1012000|content.{0,40}(security|safety) polic|(?:blocked|refused).{0,40}(security|safety) polic/i.test(error);
  const recommendation = policyBlock
    ? '\nThis is a content safety policy block; do not blindly retry the unchanged request. Adjust the prompt or reference media before another attempt.'
    : '';
  return `${stepId} failed. Model used: ${g.modelName} (${g.modelRef}), provider ${g.provider ?? g.modelRef.split('::')[0]}, parameter schema: ${source}. Provider error, verbatim: ${error}${delivery}${recommendation}`;
}
