import type { ReactNode } from 'react';
import { Zap } from './icons';
import { formatUsd } from '../../lib/format';
import type { Estimate } from '../../engine/types';
import { useStore } from '../../store/store';
import { dontAskAgain, withOncePass, type BudgetPass } from '../../engine/budget';
import { useBudgetVerdict } from './useBudgetVerdict';
import { Button, CostTag, costLabel } from './primitives';

/** The one cost checkpoint: shown right before anything that spends money. */
export function SpendConfirm({
  title,
  lines,
  estimate,
  confirmLabel = 'Run',
  onConfirm,
  onCancel,
  children,
  blocked,
  sessionId,
  resolveSessionId,
}: {
  title: ReactNode;
  lines?: ReactNode[];
  estimate: Estimate;
  confirmLabel?: string;
  /** Return the action's promise (if any): the "Continue once" pass lives until it settles and belongs only to this action. */
  onConfirm: (pass?: BudgetPass) => unknown;
  onCancel: () => void;
  children?: ReactNode;
  blocked?: string | null;
  /** The session the action will check its limit against (a result or asset of another session is not the active one). */
  sessionId?: string;
  resolveSessionId?: () => string | undefined;
}) {
  const sid = sessionId ?? useStore.getState().activeSessionId;
  const verdict = useBudgetVerdict(estimate, sid);
  const remaining = verdict.remaining;
  const over = verdict.over;
  return (
    <div className="spend">
      <div className="spend-head">
        <span className="spend-title">{title}</span>
        <CostTag estimate={estimate} />
      </div>
      {lines?.length ? (
        <ul className="spend-lines">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
      {children}
      <div className="spend-meta">
        {estimate.usd == null ? (
          <span>The provider bills the actual cost; it is not published in advance.{remaining != null ? ' With your limit on, it cannot be checked beforehand and the real cost can pass it.' : ''}</span>
        ) : estimate.approximate || estimate.lowerBound ? (
          <span>{estimate.note ?? 'Estimate from provider prices.'}</span>
        ) : (
          <span>Estimated from provider prices.</span>
        )}
        <span className="num">{remaining == null ? 'No spending limit' : `Budget left ${formatUsd(Math.max(0, remaining))}`}</span>
      </div>
      {blocked || over ? <div className="spend-warn">{blocked ?? verdict.text}</div> : null}
      <div className="spend-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {over ? (
          <Button
            variant="secondary"
            disabled={Boolean(blocked)}
            onClick={() => {
              dontAskAgain(resolveSessionId?.() ?? sid);
              onConfirm();
            }}
            data-tip="Go ahead and stop asking in this session. Change it in Settings → Budget."
          >
            Don’t ask again
          </Button>
        ) : null}
        <Button
          variant="primary"
          icon={Zap}
          disabled={Boolean(blocked)}
          onClick={() => {
            void (over ? withOncePass(resolveSessionId?.() ?? sid, (pass) => onConfirm(pass), estimate.usd, estimate.lowerBound) : onConfirm());
          }}
          autoFocus
        >
          {over ? 'Continue once' : confirmLabel} · {costLabel(estimate, { short: true })}
        </Button>
      </div>
    </div>
  );
}
