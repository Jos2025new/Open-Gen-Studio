import { noAskDurable } from '../engine/noAsk';
import type { SpendEntry } from '../engine/types';
import { formatUsd } from '../lib/format';
import { useStore } from './store';
import { toast } from './toasts';

export const MAX_SPEND_LOG = 5000;

/**
 * Count money spent (never blocks). With `entry` it is itemized in the Spending panel; crossing the limit shows one notice.
 * Passing `usd == null` records a delivered charge whose price was unknown (never counted as confirmed $0).
 * When `entry.sendId` is set, booking is idempotent: a repeated `sendId` is ignored.
 */
export function addSpend(usd: number | null | undefined, entry?: Omit<SpendEntry, 'at' | 'usd'>): void {
  const sendId = entry?.sendId;
  if (sendId && useStore.getState().spendLog.some((e) => e.sendId === sendId)) return;
  if (usd == null) {
    if (!entry) return;
    useStore.setState((st) => {
      if (sendId && st.spendLog.some((e) => e.sendId === sendId)) return {};
      return {
        spendLog: [...st.spendLog, { ...entry, at: Date.now(), usd: 0, estimated: true, unknownPrice: true }].slice(-MAX_SPEND_LOG),
      };
    });
    return;
  }
  if (!Number.isFinite(usd) || usd <= 0) return;
  const before = useStore.getState().spentUsd;
  let booked = false;
  useStore.setState((st) => {
    if (sendId && st.spendLog.some((e) => e.sendId === sendId)) return {};
    booked = true;
    return {
      spentUsd: Math.round((st.spentUsd + usd) * 10000) / 10000,
      spendLog: entry ? [...st.spendLog, { ...entry, at: Date.now(), usd }].slice(-MAX_SPEND_LOG) : st.spendLog,
    };
  });
  if (!booked) return;
  const { budgetOn, budgetUsd } = useStore.getState().settings;
  // Only the lasting rules silence it: a one-off or sequence pass ends, and the next run asks.
  const quiet = noAskDurable(useStore.getState(), entry?.sessionId);
  if (budgetOn && !quiet && before <= budgetUsd && useStore.getState().spentUsd > budgetUsd) {
    toast(`You passed your spending limit (${formatUsd(budgetUsd)}). What is running continues; new paid runs will ask first.`, 'error');
  }
}
