import type { ReactNode } from 'react';
import { Zap } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import type { Estimate } from '../../engine/types';
import { useStore } from '../../store/store';
import { dontAskAgain, withOncePass, overLimit, overLimitText, remainingBudget } from '../../engine/budget';
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
  /** Return the action's promise (if any): the "Continue once" pass lives until it settles. */
  onConfirm: () => unknown;
  onCancel: () => void;
  children?: ReactNode;
  blocked?: string | null;
  /** The session the action will check its limit against (a result or asset of another session is not the active one). */
  sessionId?: string;
  resolveSessionId?: () => string | undefined;
}) {
  // Re-render when spending or the limit change.
  useStore((s) => s.spentUsd);
  useStore((s) => s.settings);
  const remaining = remainingBudget();
  const sid = sessionId ?? useStore.getState().activeSessionId;
  const over = overLimit(estimate, sid);
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
      {blocked || over ? <div className="spend-warn">{blocked ?? overLimitText(estimate)}</div> : null}
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
            void (over ? withOncePass(resolveSessionId?.() ?? sid, onConfirm) : onConfirm());
          }}
          autoFocus
        >
          {over ? 'Continue once' : confirmLabel} · {costLabel(estimate, { short: true })}
        </Button>
      </div>
    </div>
  );
}
