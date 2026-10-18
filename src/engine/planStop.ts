import { AbortedError } from '../lib/http';
import type { ExecResult } from './executor';
import type { PlanFeedItem } from './types';

/** Plans whose run the user stopped. The executor checks it before it starts anything, so a pending step never spends after Cancel. */
const stopped = new Set<string>();

export const stopPlanRun = (planId: string): void => { stopped.add(planId); };
export const isPlanStopped = (planId?: string): boolean => Boolean(planId) && stopped.has(planId!);
/** A new run of the plan (first run or resume) starts clean. */
export const clearPlanStop = (planId?: string): void => { if (planId) stopped.delete(planId); };
/** Thrown by a step that was about to send after Cancel. */
export const stoppedError = (): Error => new AbortedError();

/** How a plan run ended: stopped by the user, or by what its steps did. */
export function finalPlanStatus(result: ExecResult): PlanFeedItem['status'] {
  const failed = result.failed.length;
  return result.stopped ? 'canceled' : result.waiting.length ? 'review' : failed === 0 && !result.skipped.length ? 'done' : result.outputs.size ? 'partial' : 'error';
}
