import type { ReactNode } from 'react';
import { Zap } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import type { Estimate } from '../../engine/types';
import { useStore } from '../../store/store';
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
}: {
  title: ReactNode;
  lines?: ReactNode[];
  estimate: Estimate;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  blocked?: string | null;
}) {
  const remaining = useStore((s) => s.settings.budgetUsd - s.spentUsd);
  const over = estimate.usd != null && estimate.usd > remaining + 1e-9;
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
          <span>The provider bills the actual cost; it is not published in advance.</span>
        ) : estimate.approximate || estimate.lowerBound ? (
          <span>{estimate.note ?? 'Estimate from provider prices.'}</span>
        ) : (
          <span>Estimated from provider prices.</span>
        )}
        <span className="num">Budget left {formatUsd(Math.max(0, remaining))}</span>
      </div>
      {blocked || over ? <div className="spend-warn">{blocked ?? 'Over your remaining budget. Raise it in Settings.'}</div> : null}
      <div className="spend-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" icon={Zap} disabled={Boolean(blocked) || over} onClick={onConfirm} autoFocus>
          {confirmLabel} · {costLabel(estimate, { short: true })}
        </Button>
      </div>
    </div>
  );
}
