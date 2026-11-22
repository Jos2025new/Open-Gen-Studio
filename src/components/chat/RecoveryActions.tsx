import { useState } from 'react';
import { RefreshCw, RotateCw } from '../ui/icons';
import { planRecovery, planRecoveryProblem, resumePlan, type PlanRecoveryMode } from '../../engine/agent/runtime';
import { dontAskAgain, withOncePass, type BudgetPass } from '../../engine/budget';
import { canRecheck, recheckGeneration, retryGeneration } from '../../engine/jobs';
import { FREE } from '../../engine/pricing';
import { estimateForRetry } from '../../engine/retryPartial';
import type { Generation, PlanFeedItem } from '../../engine/types';
import { toast, useStore } from '../../store/store';
import { Button, costLabel } from '../ui/primitives';
import { readBudgetVerdict, useBudgetVerdict } from '../ui/useBudgetVerdict';

/*
 * What to do after a generation fails: Check status asks the provider again about a job it received (only when it
 * gave a job id); Retry runs it again. A step of a plan resumes the plan, so the steps waiting for it run too.
 */

const NO_JOB_TIP = 'The provider gave no job id to ask about (NanoGPT returns images in the same request). Retry runs it again.';

const isUncertain = (g: Generation | undefined) => Boolean(g && (g.lostJob || g.sends?.some((s) => s.status === 'uncertain' || s.status === 'intent')));

/** Suggestions under a failed plan: Check status (steps with a job id) and Retry failed (with its price). */
export function PlanRecoveryChips({ sessionId, item }: { sessionId: string; item: PlanFeedItem }) {
  const [confirmRetry, setConfirmRetry] = useState<'once' | 'quiet' | null>(null);
  const gens = useStore((s) => s.generations);
  const r = planRecovery(item);
  const retryVerdict = useBudgetVerdict(r ? r.estimate : FREE, sessionId);
  const checkVerdict = useBudgetVerdict(r ? r.rest : FREE, sessionId);
  if (!r) return null;
  const uncertain = r.retry.some((st) => isUncertain(gens[item.stepGenerations[st.id] ?? '']));
  const run = (mode: PlanRecoveryMode) => {
    const go = (pass?: BudgetPass) => {
      const problem = planRecoveryProblem(item, mode, sessionId, pass);
      if (problem) {
        toast(problem, 'info');
        return;
      }
      return resumePlan(sessionId, item.id, mode, true, pass);
    };
    void (readBudgetVerdict(mode === 'retry' ? r.estimate : r.rest, sessionId).over ? withOncePass(sessionId, go) : go());
  };
  const quiet = (mode: PlanRecoveryMode) => { dontAskAgain(sessionId); run(mode); };
  const confirmAndRetry = () => {
    const mode = confirmRetry;
    setConfirmRetry(null);
    if (mode === 'quiet') quiet('retry');
    else run('retry');
  };
  const over = retryVerdict.over;
  return (
    <div className="recover-chips">
      {r.checkable.length ? (
        <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => run('check')} data-tip={checkVerdict.over ? checkVerdict.text : 'Ask the provider again about the jobs it received; the steps waiting for them run next'}>
          {checkVerdict.over ? 'Check once' : 'Check status'}
        </Button>
      ) : null}
      {confirmRetry ? (
        <>
          <span className="faint">May have been charged.</span>
          <Button size="sm" variant="secondary" icon={RotateCw} onClick={confirmAndRetry}>
            Resend anyway · {costLabel(r.estimate, { short: true })}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmRetry(null)}>Cancel</Button>
        </>
      ) : (
        <>
          {over ? <Button size="sm" variant="ghost" onClick={() => (uncertain ? setConfirmRetry('quiet') : quiet('retry'))} data-tip="Retry and stop asking in this session. Change it in Settings → Budget.">Don’t ask again</Button> : null}
          <Button size="sm" variant="secondary" icon={RotateCw} onClick={() => (uncertain ? setConfirmRetry('once') : run('retry'))} data-tip={over ? retryVerdict.text : r.checkable.length ? 'Runs the failed steps again (charged again)' : NO_JOB_TIP}>
            {over ? 'Continue once' : 'Retry failed'} · {costLabel(r.estimate, { short: true })}
          </Button>
        </>
      )}
    </div>
  );
}

/** Buttons on a failed generation card. A plan's step defers to its plan, so the plan resumes. */
export function GenerationRecovery({ g }: { g: Generation }) {
  const [confirmUncertain, setConfirmUncertain] = useState<'once' | 'quiet' | null>(null);
  const planItem = useStore((s) => (g.planId ? s.sessions[g.sessionId]?.feed.find((f): f is PlanFeedItem => f.type === 'plan' && f.plan.id === g.planId) : undefined));
  const estimate = estimateForRetry(g);
  const verdict = useBudgetVerdict(estimate, g.sessionId);
  if (planItem && planRecovery(planItem)) return <PlanRecoveryChips sessionId={g.sessionId} item={planItem} />;
  const checkable = canRecheck(g);
  const uncertain = isUncertain(g);
  const over = verdict.over;
  const startRetry = () => {
    const mode = confirmUncertain;
    setConfirmUncertain(null);
    if (mode === 'quiet') {
      dontAskAgain(g.sessionId);
      void retryGeneration(g.id);
      return;
    }
    void (over ? withOncePass(g.sessionId, (pass) => retryGeneration(g.id, undefined, pass)) : retryGeneration(g.id));
  };
  return (
    <div className="recover-chips">
      {checkable ? (
        <Button size="sm" variant="secondary" icon={RefreshCw} className="gen-recheck" data-tip="The job was submitted and may still finish at the provider" onClick={() => void recheckGeneration(g.id)}>
          Check status
        </Button>
      ) : null}
      {confirmUncertain ? (
        <>
          <span className="faint">May have been charged.</span>
          <Button size="sm" variant="secondary" icon={RotateCw} onClick={startRetry}>
            Resend anyway · {costLabel(estimate, { short: true })}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmUncertain(null)}>Cancel</Button>
        </>
      ) : (
        <>
          {over ? <Button size="sm" variant="ghost" onClick={() => { if (uncertain) setConfirmUncertain('quiet'); else { dontAskAgain(g.sessionId); void retryGeneration(g.id); } }} data-tip="Retry and stop asking in this session. Change it in Settings → Budget.">Don’t ask again</Button> : null}
          <Button
            size="sm"
            variant="secondary"
            icon={RotateCw}
            data-tip={over ? verdict.text : checkable ? 'Runs it again (charged again)' : NO_JOB_TIP}
            onClick={() => (uncertain ? setConfirmUncertain('once') : startRetry())}
          >
            {over ? 'Continue once' : 'Retry'} · {costLabel(estimate, { short: true })}
          </Button>
        </>
      )}
    </div>
  );
}
