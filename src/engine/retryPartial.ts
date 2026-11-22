import { sumEstimates } from './pricing';
import type { Estimate, Generation, PlanFeedItem, PlanStep } from './types';

/** Retry price is proportional to outputs still owed; a scaled full-run quote becomes an estimate. */
export function retryEstimate(estimate: Estimate, total: number, delivered: number): Estimate {
  const remaining = Math.max(0, total - delivered);
  if (estimate.usd == null || total <= 0) return estimate;
  return { ...estimate, usd: estimate.usd * remaining / total, approximate: estimate.approximate || remaining !== total, exact: remaining === total ? estimate.exact : false };
}

export function estimateForRetry(g: Generation): Estimate {
  const total = g.retryTotal ?? (g.variants ? g.assetIds.length + g.variants.length : g.settings.count);
  return retryEstimate(g.retryBaseEstimate ?? g.estimate, total, g.assetIds.length);
}

export function retrySpec(g: Generation) {
  return { settings: { ...g.settings, seed: (g.settings.seed ?? 0) + 1 }, inputs: g.inputs, op: g.op, origin: g.origin, place: g.place, mode: g.mode, parentId: g.id, operationId: g.operationId ?? g.id, planId: g.planId, stepId: g.stepId, estimate: estimateForRetry(g), variants: g.variants };
}

export function planRetryEstimate(steps: PlanStep[], perStep: Record<string, Estimate>, item: PlanFeedItem, generations: Record<string, Generation>): Estimate {
  let unpricedSubstitute = false;
  const total = sumEstimates(steps.map((step) => {
    const g = generations[item.stepGenerations[step.id] ?? ''];
    const estimate = perStep[step.id];
    if (item.stepStates[step.id] !== 'error' || !g) return estimate;
    const plannedModel = 'modelRef' in step ? step.modelRef : item.stepAuthorizations?.[step.id]?.modelRef;
    if (plannedModel && g.modelRef !== plannedModel) {
      const actual = estimateForRetry(g);
      unpricedSubstitute ||= actual.usd == null || Boolean(actual.lowerBound);
      return actual;
    }
    return g.assetIds.length ? retryEstimate(g.retryBaseEstimate ?? estimate, g.retryTotal ?? (g.variants ? g.assetIds.length + g.variants.length : g.settings.count), g.assetIds.length) : estimate;
  }));
  return unpricedSubstitute ? { ...total, usd: null } : total;
}

export function partialRetryCharge(g: Generation, parent?: Generation): number | undefined {
  const delivered = Math.max(0, g.assetIds.length - (parent?.assetIds.length ?? 0));
  if (!delivered) return 0;
  const base = (g.retryBaseEstimate ?? g.estimate).usd;
  if (base == null) return undefined;
  const total = Math.max(1, g.retryTotal ?? g.settings.count);
  return base * delivered / total;
}
