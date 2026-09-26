import { formatUsd } from '../lib/format';
import { setSettings, useStore } from '../store/store';
import type { Estimate } from './types';

/*
 * The spending limit warns, it does not block: with no limit, or once the user chose to go past it, runs go
 * ahead and spending is only shown. What is already running is never stopped for its cost.
 */

const get = useStore.getState;

/** Money left under the limit, or null when there is no limit. */
export function remainingBudget(): number | null {
  const { settings, spentUsd } = get();
  return settings.budgetOn ? settings.budgetUsd - spentUsd : null;
}

/** The user already chose to continue past the current limit. */
export function overLimitAccepted(): boolean {
  const { budgetOn, budgetUsd, budgetAccepted } = get().settings;
  return !budgetOn || budgetAccepted === budgetUsd;
}

/** This run would go over an active limit the user has not accepted going past (unknown prices do not count). */
export function overLimit(e: Estimate): boolean {
  const left = remainingBudget();
  return left != null && !overLimitAccepted() && e.usd != null && e.usd > left + 1e-9;
}

/** What the confirmation says when a run goes over the limit. */
export function overLimitText(e: Estimate): string {
  const { budgetUsd } = get().settings;
  const left = Math.max(0, remainingBudget() ?? 0);
  return `Goes over your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left${e.usd != null ? `, this costs ${formatUsd(e.usd)}` : ''}). Continue anyway? Further runs will not ask again until you change the limit.`;
}

/** "Continue anyway": runs stop asking until the limit changes or spending is reset. */
export function acceptOverLimit(): void {
  setSettings((s) => ({ budgetAccepted: s.budgetUsd }));
}
