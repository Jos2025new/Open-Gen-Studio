import type { Generation } from '../../engine/types';
import { formatUsd } from '../../lib/format';

/**
 * What a running plan has cost so far, from known costs only. A multi-output generation stores its cost when it ends,
 * so a live one without it is unknown, not free: the sum is then a lower bound ("partial") and may be zero-but-unknown.
 */
export function plannedSpend(stepGenerations: Record<string, string>, generations: Record<string, Generation>): { usd: number; partial: boolean } {
  let usd = 0;
  let partial = false;
  for (const id of Object.values(stepGenerations)) {
    const g = generations[id];
    if (!g) continue;
    if (g.actualUsd != null) usd += g.actualUsd;
    else if (g.status === 'running' || g.status === 'queued') partial = true;
  }
  return { usd, partial };
}

/** The "spent" text of the progress line: nothing while nothing is known, "≥$X" while some cost is still unknown. */
export function spentLabel(s: { usd: number; partial: boolean }): string {
  if (!s.partial) return `spent ${formatUsd(s.usd)}`;
  return s.usd > 0 ? `spent ≥${formatUsd(s.usd)}` : '';
}
