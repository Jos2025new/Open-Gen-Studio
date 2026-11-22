import { pruneJoins } from '../plan';
import { estimateSteps } from '../executor';
import { canRecheck } from '../jobs';
import { planRetryEstimate } from '../retryPartial';
import { budgetProblem, type BudgetPass } from '../budget';
import { get } from './runtimeShared';
import type { Estimate, PlanFeedItem, PlanStep } from '../types';

/* Recovering a plan with failed steps: which steps qualify, the retry price and why a recovery cannot start. */

export type PlanRecoveryMode = 'check' | 'retry';

/** Selected plan steps eligible for recovery. */
export function approvedSteps(item: PlanFeedItem): { chosen: PlanStep[]; off: Set<string> } {
  const off = new Set(item.skipped ?? []);
  const pruned = pruneJoins(item.plan.steps.filter((st) => !off.has(st.id)), off);
  for (const id of pruned.dropped) off.add(id);
  return { chosen: pruned.steps, off };
}

/** Failed plan recovery options and the remaining retry price. */
export function planRecovery(item: PlanFeedItem): { checkable: string[]; retry: PlanStep[]; estimate: Estimate; rest: Estimate } | null {
  if ((item.status !== 'error' && item.status !== 'partial') || item.plan.workspace === 'node') return null;
  const gens = get().generations;
  const { chosen } = approvedSteps(item);
  const retry = chosen.filter((st) => item.stepStates[st.id] === 'error' || item.stepStates[st.id] === 'skipped' || item.stepStates[st.id] === 'pending');
  if (!retry.length) return null;
  const checkable = retry.filter((st) => {
    const g = gens[item.stepGenerations[st.id] ?? ''];
    return item.stepStates[st.id] === 'error' && g && canRecheck(g);
  }).map((st) => st.id);
  const price = estimateSteps(retry);
  // `rest`: what a check can spend (steps that run for the first time); asking about a submitted job costs nothing.
  return { checkable, retry, estimate: planRetryEstimate(retry, price.perStep, item, gens), rest: planRetryEstimate(retry.filter((st) => !checkable.includes(st.id)), price.perStep, item, gens) };
}

/** Why a recovery cannot start, in words for the user or the agent; null when it can. */
export function planRecoveryProblem(item: PlanFeedItem, mode: PlanRecoveryMode, sessionId: string, budgetPass?: BudgetPass): string | null {
  const r = planRecovery(item);
  if (!r) return item.plan.workspace === 'node' ? 'Plans on the Node canvas are rerun from their nodes.' : 'This plan has no failed steps.';
  if (mode === 'check' && !r.checkable.length) {
    return 'No failed step has a submitted job to check: the provider gave no job id (NanoGPT returns images in the same request, so a dropped connection leaves nothing to ask for). Retry runs them again.';
  }
  const cost = mode === 'check' ? r.rest : r.estimate;
  return budgetProblem(cost, sessionId, budgetPass);
}
