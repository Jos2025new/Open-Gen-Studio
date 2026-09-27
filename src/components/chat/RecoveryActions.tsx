import { RefreshCw, RotateCw } from 'lucide-react';
import { planRecovery, planRecoveryProblem, resumePlan, type PlanRecoveryMode } from '../../engine/agent/runtime';
import { acceptOverLimit, overLimit, overLimitText } from '../../engine/budget';
import { canRecheck, recheckGeneration, retryGeneration } from '../../engine/jobs';
import type { Generation, PlanFeedItem } from '../../engine/types';
import { toast, useStore } from '../../store/store';
import { Button, costLabel } from '../ui/primitives';

/*
 * What to do after a generation fails: Check status asks the provider again about a job it received (only when it
 * gave a job id); Retry runs it again. A step of a plan resumes the plan, so the steps waiting for it run too.
 */

const NO_JOB_TIP = 'The provider gave no job id to ask about (NanoGPT returns images in the same request). Retry runs it again.';

/** Suggestions under a failed plan: Check status (steps with a job id) and Retry failed (with its price). */
export function PlanRecoveryChips({ sessionId, item }: { sessionId: string; item: PlanFeedItem }) {
  useStore((s) => s.generations);
  useStore((s) => s.spentUsd);
  const r = planRecovery(item);
  if (!r) return null;
  const run = (mode: PlanRecoveryMode) => {
    if (mode === 'retry' && overLimit(r.estimate)) acceptOverLimit();
    const problem = planRecoveryProblem(item, mode);
    if (problem) {
      toast(problem, 'info');
      return;
    }
    void resumePlan(sessionId, item.id, mode);
  };
  const over = overLimit(r.estimate);
  return (
    <div className="recover-chips">
      {r.checkable.length ? (
        <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => run('check')} data-tip="Ask the provider again about the jobs it received; the steps waiting for them run next">
          Check status
        </Button>
      ) : null}
      <Button size="sm" variant="secondary" icon={RotateCw} onClick={() => run('retry')} data-tip={over ? overLimitText(r.estimate) : r.checkable.length ? 'Runs the failed steps again (charged again)' : NO_JOB_TIP}>
        {over ? 'Retry anyway' : 'Retry failed'} · {costLabel(r.estimate, { short: true })}
      </Button>
    </div>
  );
}

/** Buttons on a failed generation card. A plan's step defers to its plan, so the plan resumes. */
export function GenerationRecovery({ g }: { g: Generation }) {
  const planItem = useStore((s) => (g.planId ? s.sessions[g.sessionId]?.feed.find((f): f is PlanFeedItem => f.type === 'plan' && f.plan.id === g.planId) : undefined));
  useStore((s) => s.spentUsd);
  if (planItem && planRecovery(planItem)) return <PlanRecoveryChips sessionId={g.sessionId} item={planItem} />;
  const checkable = canRecheck(g);
  const over = overLimit(g.estimate);
  return (
    <div className="recover-chips">
      {checkable ? (
        <Button size="sm" variant="secondary" icon={RefreshCw} className="gen-recheck" data-tip="The job was submitted and may still finish at the provider" onClick={() => void recheckGeneration(g.id)}>
          Check status
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        icon={RotateCw}
        data-tip={over ? overLimitText(g.estimate) : checkable ? 'Runs it again (charged again)' : NO_JOB_TIP}
        onClick={() => {
          if (over) acceptOverLimit();
          void retryGeneration(g.id);
        }}
      >
        {over ? 'Retry anyway' : 'Retry'} · {costLabel(g.estimate, { short: true })}
      </Button>
    </div>
  );
}
