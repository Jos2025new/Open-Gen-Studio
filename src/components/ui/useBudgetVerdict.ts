import { useSyncExternalStore } from 'react';
import { budgetVerdict, subscribeUntilNextSession, untilNextSessionActive, type BudgetVerdict } from '../../engine/budget';
import type { Estimate } from '../../engine/types';
import { useStore } from '../../store/store';

/**
 * UI adapter for the single spending-limit rule (`budgetVerdict`).
 * Subscribes to spending, limit settings, session no-ask, and "until next session" so components
 * read a ready-made verdict instead of recalculating the limit rule themselves.
 */
export function useBudgetVerdict(estimate: Estimate, sessionId?: string, choices?: string): BudgetVerdict {
  useStore((s) => s.spentUsd);
  useStore((s) => s.settings.budgetOn);
  useStore((s) => s.settings.budgetUsd);
  useStore((s) => s.settings.budgetNoAsk);
  useStore((s) => s.settings.budgetAccepted);
  const activeSessionId = useStore((s) => s.activeSessionId);
  useStore((s) => s.sessions[sessionId ?? activeSessionId]?.noAskOverLimit ?? false);
  useSyncExternalStore(subscribeUntilNextSession, untilNextSessionActive, untilNextSessionActive);
  return budgetVerdict(estimate, { sessionId: sessionId ?? activeSessionId, choices });
}

/** On-demand verdict read for event handlers or per-item loops inside components that already subscribe. */
export function readBudgetVerdict(estimate: Estimate, sessionId?: string, choices?: string): BudgetVerdict {
  return budgetVerdict(estimate, { sessionId, choices });
}
