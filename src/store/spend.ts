import { noAskDurable } from '../engine/noAsk';
import type { SpendEntry } from '../engine/types';
import { formatUsd } from '../lib/format';
import { useStore } from './store';
import { toast } from './toasts';

export const MAX_SPEND_LOG = 5000;

/** Count money spent (never blocks). With `entry` it is itemized in the Spending panel; crossing the limit shows one notice. */
export function addSpend(usd: number, entry?: Omit<SpendEntry, 'at' | 'usd'>): void {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const before = useStore.getState().spentUsd;
  useStore.setState((st) => ({
    spentUsd: Math.round((st.spentUsd + usd) * 10000) / 10000,
    spendLog: entry ? [...st.spendLog, { ...entry, at: Date.now(), usd }].slice(-MAX_SPEND_LOG) : st.spendLog,
  }));
  const { budgetOn, budgetUsd } = useStore.getState().settings;
  // Only the lasting rules silence it: a one-off or sequence pass ends, and the next run asks.
  const quiet = noAskDurable(useStore.getState(), entry?.sessionId);
  if (budgetOn && !quiet && before <= budgetUsd && useStore.getState().spentUsd > budgetUsd) {
    toast(`You passed your spending limit (${formatUsd(budgetUsd)}). What is running continues; new paid runs will ask first.`, 'error');
  }
}
