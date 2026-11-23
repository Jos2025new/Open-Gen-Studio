import type { PlanFeedItem, StepState } from '../types';
import { updateFeedItem, useStore } from '../../store/store';
import { ensureUncertainChargeNotice, hasActiveTicketSend, storeTickets } from '../money/storeBridge';
import { markSendUncertain } from '../money/ticket';
import { settleInterruptedCommandCards } from './commandCalls';
import { recordPriceResults } from './priceNotes';

const get = () => useStore.getState();

/**
 * After a reload, plans and command cards that were running have lost their executor. Their generations are resumed by
 * `resumeInterrupted`; follow them and close each card with its real outcome instead of "Running" forever.
 * Nothing is submitted again: steps that had not started before the reload are reported as not run (or await one-click approval for command cards).
 */
export function settleInterruptedPlans(): void {
  // Transition any unacknowledged in-flight LLM ticket sends from before reload to uncertain (keeping reservation).
  for (const t of storeTickets.list()) {
    if (t.kind !== 'llm') {
      ensureUncertainChargeNotice(t);
      continue;
    }
    let next = t;
    for (const s of t.sends) {
      if (s.status === 'in_flight') next = markSendUncertain(next, s.id, 'Interrupted by reload');
    }
    if (next !== t) storeTickets.put(next);
    ensureUncertainChargeNotice(next);
  }
  settleInterruptedCommandCards();
  for (const s of Object.values(get().sessions)) for (const f of s.feed) if (f.type === 'plan') recordPriceResults(s.id, f.id);
  const open = new Set<string>();
  for (const s of Object.values(get().sessions)) for (const f of s.feed) if (f.type === 'plan' && f.status === 'running') open.add(`${s.id}|${f.id}`);
  if (!open.size) return;
  const check = () => {
    const gens = get().generations;
    for (const key of [...open]) {
      const [sessionId, itemId] = key.split('|');
      const item = get().sessions[sessionId]?.feed.find((f) => f.id === itemId);
      if (!item || item.type !== 'plan' || item.status !== 'running') {
        open.delete(key);
        continue;
      }
      const selected = item.plan.steps.filter((step) => !item.skipped?.includes(step.id) && !item.canceledSteps?.includes(step.id));
      if (item.plan.workspace !== 'node' && selected.length && selected.every((step) =>
        !item.stepGenerations[step.id] && (item.stepStates[step.id] === 'pending' || !item.stepStates[step.id]),
      ) && !storeTickets.get(`plan:${item.id}`)?.sends.some((send) => send.status !== 'pending')) {
        open.delete(key);
        updateFeedItem<PlanFeedItem>(sessionId, itemId, { status: 'awaiting', error: undefined });
        continue;
      }
      const states: Record<string, StepState> = { ...item.stepStates };
      let pending = false;
      const review = Object.values(states).includes('review');
      for (const st of item.plan.steps) {
        const gid = item.stepGenerations[st.id];
        const g = gid ? gens[gid] : undefined;
        if (g) {
          states[st.id] = g.status === 'review'
            ? 'review'
            : g.status === 'done'
              ? 'done'
              : g.status === 'error' || g.status === 'canceled'
                ? 'error'
                : hasActiveTicketSend(g) || g.status === 'running' || g.status === 'queued'
                  ? ((pending = true), 'running')
                  : 'error';
        } else if (!review && states[st.id] !== 'done') states[st.id] = 'skipped';
      }
      if (pending) continue;
      open.delete(key);
      const done = Object.values(states).filter((v) => v === 'done').length;
      const all = item.plan.steps.length;
      updateFeedItem<PlanFeedItem>(sessionId, itemId, {
        stepStates: states,
        status: review ? 'review' : done === all ? 'done' : done ? 'partial' : 'error',
        error: review || done === all ? undefined : 'Interrupted by a page reload; some steps did not run.',
      });
      recordPriceResults(sessionId, itemId);
    }
    if (!open.size) unsubscribe();
  };
  const unsubscribe = useStore.subscribe(check);
  check();
}
