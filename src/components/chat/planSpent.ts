import { ledgerCost } from '../../engine/sendLedger';
import { formatSpendAmount } from '../../engine/spending';
import type { Generation } from '../../engine/types';
import { formatUsd } from '../../lib/format';

/**
 * What a running plan has cost so far, from known costs only. A multi-output generation stores its cost when it ends,
 * so a live one without it is unknown, not free: the sum is then a lower bound ("partial") and may be zero-but-unknown.
 * A finished or partially delivered step whose price is unknown also keeps the sum partial/unknown, never confirmed "$0".
 */
export function plannedSpend(stepGenerations: Record<string, string>, generations: Record<string, Generation>): { usd: number; partial: boolean; unknown: boolean } {
  let usd = 0;
  let partial = false;
  let unknown = false;
  for (const id of Object.values(stepGenerations)) {
    const g = generations[id];
    if (!g) continue;
    if (g.actualUsd != null) {
      usd += g.actualUsd;
    } else if (g.sends?.some((s) => s.status === 'done')) {
      const b = ledgerCost(g);
      usd += b.usd;
      if (b.hasUnknown) { partial = true; unknown = true; }
      if (g.status === 'running' || g.status === 'queued') partial = true;
    } else if (g.status === 'running' || g.status === 'queued') {
      partial = true;
    } else if (g.status === 'done') {
      if (g.estimate?.usd != null) usd += g.estimate.usd;
      else { partial = true; unknown = true; }
    } else if (g.assetIds?.length) {
      if (g.estimate?.usd == null) { partial = true; unknown = true; }
      else if (g.estimate.usd > 0) partial = true;
    }
  }
  return { usd: Math.round(usd * 10000) / 10000, partial, unknown };
}

/** The "spent" text of the progress line: nothing while in-flight and nothing is known, "price unknown" when a delivered cost is unknown, "≥$X" while some cost is still unknown. */
export function spentLabel(s: { usd: number; partial: boolean; unknown?: boolean }): string {
  if (!s.partial) return `spent ${formatUsd(s.usd)}`;
  if (s.usd > 0) return `spent ${formatSpendAmount(s.usd, { unknown: true })}`;
  return s.unknown ? formatSpendAmount(0, { unknown: true }).toLowerCase() : '';
}
