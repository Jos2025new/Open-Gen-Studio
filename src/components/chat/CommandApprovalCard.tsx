import { decideCommandApproval } from '../../engine/agent/commandCalls';
import { overLimit, overLimitText, remainingBudget } from '../../engine/budget';
import type { CommandApprovalFeedItem, CommandApprovalStep } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { useStore } from '../../store/store';
import { CircleAlert, Trash, Wand } from '../ui/icons';
import { Button, costLabel } from '../ui/primitives';

const LIMIT_CHOICES = '“Allow this time” lets only this sequence through; “Allow for the whole session” stops asking in this session; “Don’t ask again until next session” stops asking until a new session starts or the limit changes. Nothing is stopped.';

function stepArgSummary(step: CommandApprovalStep): string {
  if (!step.args || typeof step.args !== 'object') return '';
  const entries = Object.entries(step.args as Record<string, unknown>).flatMap(([k, v]) => {
    if (v == null || v === '') return [];
    if (Array.isArray(v)) return v.length ? [`${k}: ${v.map(String).join(', ')}`] : [];
    if (typeof v === 'object') return [];
    return [`${k}: ${String(v)}`];
  });
  return entries.join(' · ');
}

export function CommandApprovalCard({ item, sessionId }: { item: CommandApprovalFeedItem; sessionId: string }) {
  // Subscribe to spending and budget state so the card updates when the limit or session pass changes.
  useStore((s) => `${s.spentUsd}:${s.settings.budgetOn}:${s.settings.budgetUsd}:${s.sessions[sessionId]?.noAskOverLimit ?? false}`);
  const hasSpend = item.steps.some((s) => s.effect === 'spend');
  const hasDelete = item.steps.some((s) => s.effect === 'delete');
  const total = item.estimate;
  const free = !hasSpend || (total.usd === 0 && !total.approximate);
  const over = item.status === 'awaiting' && hasSpend && overLimit(total, sessionId);
  const remaining = remainingBudget();
  const title =
    item.steps.length === 1
      ? item.steps[0].title
      : hasSpend && hasDelete
        ? `${item.steps.length} actions (spend & delete)`
        : hasSpend
          ? `Run ${item.steps.length} steps`
          : `Delete (${item.steps.length} steps)`;

  return (
    <article className={`plan-card cc-w st-${item.status}`}>
      <header className="plan-head">
        <span className="plan-title">{title}</span>
        {hasSpend ? <span className="plan-cost num">{costLabel(total)}</span> : null}
      </header>
      <ol className="plan-steps">
        {item.steps.map((s) => {
          const summary = stepArgSummary(s);
          return (
            <li key={s.step} className="plan-step">
              <span className="step-main">
                <span className={`kind-icon k-${s.effect === 'delete' ? 'layer' : 'op'}`}>
                  {s.effect === 'delete' ? <Trash size={13} /> : <Wand size={13} />}
                </span>
                <span className="step-num num">{s.step}</span>
                <span className="step-title">{s.title}</span>
                <span className="step-detail faint">{[s.cmd, summary].filter(Boolean).join(' · ')}</span>
                <span className="step-cost faint num">{s.effect === 'spend' ? costLabel(s.estimate) : 'Delete'}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {over ? (
        <p className="plan-user-model">
          <CircleAlert size={12} /> {overLimitText(total, LIMIT_CHOICES)}
        </p>
      ) : null}
      {item.error ? <p className="plan-error">{item.error}</p> : null}
      <footer className="plan-foot">
        {item.status === 'awaiting' ? (
          <>
            <span className="plan-budget faint num">
              {!hasSpend
                ? 'Needs confirmation'
                : total.usd == null
                  ? 'Price not published — billed at actual cost'
                  : free
                    ? 'Nothing to pay'
                    : remaining == null
                      ? 'No spending limit'
                      : `Budget left ${formatUsd(Math.max(0, remaining))}`}
            </span>
            <Button variant="ghost" onClick={() => decideCommandApproval(sessionId, item.id, 'cancel')}>
              Cancel
            </Button>
            {over ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => decideCommandApproval(sessionId, item.id, 'until-next-session')}
                  data-tip="Approve and stop asking until next session."
                >
                  Don’t ask again until next session
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => decideCommandApproval(sessionId, item.id, 'session')}
                  data-tip="Approve and stop asking for the whole session."
                >
                  Allow for the whole session
                </Button>
                <Button
                  variant="primary"
                  className="cc-approve"
                  onClick={() => decideCommandApproval(sessionId, item.id, 'once')}
                  data-tip={overLimitText(total, LIMIT_CHOICES)}
                >
                  {free ? (
                    'Allow this time'
                  ) : (
                    <>
                      Allow this time
                      <span className="cc-ap-sep" aria-hidden>
                        ·
                      </span>
                      <span className="cc-ap-cost num">{costLabel(total, { short: true })}</span>
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                className="cc-approve"
                onClick={() => decideCommandApproval(sessionId, item.id, 'approve')}
              >
                {free ? (
                  'Approve'
                ) : (
                  <>
                    Approve
                    <span className="cc-ap-sep" aria-hidden>
                      ·
                    </span>
                    <span className="cc-ap-cost num">{costLabel(total, { short: true })}</span>
                  </>
                )}
              </Button>
            )}
          </>
        ) : item.status === 'running' ? (
          <span className="plan-progress faint num">Running…</span>
        ) : (
          <span className={`plan-final st-${item.status} num`}>
            {item.status === 'done' ? 'Done' : item.status === 'canceled' ? 'Canceled' : 'Failed'}
          </span>
        )}
      </footer>
    </article>
  );
}
