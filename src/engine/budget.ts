import { formatUsd } from '../lib/format';
import { uid } from '../lib/id';
import { appendFeed, patchSession, setUi, updateFeedItem, useStore } from '../store/store';
import type { Estimate, NoticeFeedItem } from './types';

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

/**
 * "Continue once": a pass for ONE session that lives exactly as long as the approved action (withOncePass). It is also spent
 * when that action creates its first generation (so a batch such as Run all, approved once, is one run). Painting never
 * spends it. If the action ends without creating one (the graph changed, a recovery was refused, an error), it dies with it.
 */
let pass: { sessionId: string } | null = null;

/** The session whose runs no longer ask (the active one by default). */
function sessionNoAsk(sessionId?: string): boolean {
  const s = get();
  return Boolean(s.sessions[sessionId ?? s.activeSessionId]?.noAskOverLimit);
}

/** Over-limit runs go ahead without asking: no limit, "Don't ask in any session" (or a limit accepted by an older version), this session's "Don't ask again", or a "Continue once" just given. */
export function overLimitAccepted(sessionId?: string): boolean {
  const { budgetOn, budgetUsd, budgetAccepted, budgetNoAsk } = get().settings;
  return !budgetOn || Boolean(budgetNoAsk) || budgetAccepted === budgetUsd || sessionNoAsk(sessionId) || passFor(sessionId ?? get().activeSessionId);
}

function passFor(sessionId: string): boolean {
  return pass?.sessionId === sessionId;
}

/** The approved action started spending: the pass is used up. */
export function consumeOnce(sessionId: string): void {
  if (pass?.sessionId === sessionId) pass = null;
}

/** This run would go over an active limit nobody agreed to go past. An unknown price cannot be checked against it, so it asks too. */
export function overLimit(e: Estimate, sessionId?: string): boolean {
  const left = remainingBudget();
  return left != null && !overLimitAccepted(sessionId) && (e.usd == null || e.usd > left + 1e-9);
}

/** What the confirmation says when a run goes over the limit. */
export function overLimitText(e: Estimate): string {
  const { budgetUsd } = get().settings;
  const left = Math.max(0, remainingBudget() ?? 0);
  const choices = '“Continue once” lets only this run through; “Don\u2019t ask again” stops asking in this session. Nothing running is stopped.';
  if (e.usd == null) return `The price of this run is not published, so it cannot be checked against your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left). The real cost can pass it. ${choices}`;
  return `Goes over your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left, this costs ${formatUsd(e.usd)}). ${choices}`;
}

/**
 * "Continue once": run the approved action with this session's pass, and retire the pass when the action ends, finishes
 * or fails, whether or not it created a generation. The next run that goes over asks again.
 */
export function withOncePass<T>(sessionId: string, action: () => T): T {
  const mine = { sessionId };
  pass = mine;
  const end = () => { if (pass === mine) pass = null; };
  let result: T;
  try { result = action(); } catch (e) { end(); throw e; }
  if (result instanceof Promise) return result.finally(end) as T;
  end();
  return result;
}

/** "Don't ask again": this run goes ahead and so do the rest of this session's. Other sessions still ask. */
export function dontAskAgain(sessionId: string = get().activeSessionId): void {
  patchSession(sessionId, (s) => ({ ...s, noAskOverLimit: true }));
}

/** "Ask again": this session asks once more. */
export function askAgain(sessionId: string = get().activeSessionId): void {
  pass = null;
  patchSession(sessionId, (s) => ({ ...s, noAskOverLimit: false }));
}

/** Open Settings on the Budget tab. */
export function openBudgetSettings(): void {
  try { localStorage.setItem('ogs:settings-tab', JSON.stringify('budget')); } catch { /* storage unavailable */ }
  setUi({ settingsOpen: true });
}

/**
 * A run with an unknown price was let through; once its real cost is booked and the total is over the limit, say so once,
 * naming it. No margin: any excess counts. Never stops anything.
 */
export function noteExcess(generationId: string): void {
  const { settings, spentUsd, sessions, generations } = get();
  const g = generations[generationId];
  const session = g && sessions[g.sessionId];
  if (!g || g.estimate.usd != null || g.actualUsd == null || !settings.budgetOn || !session || spentUsd <= settings.budgetUsd + 1e-9) return;
  if (session.feed.some((f) => f.type === 'notice' && f.overLimitFor?.gen === g.id)) return;
  const what = g.prompt.trim().slice(0, 40) || g.kind;
  const text = `“${what}” had no published price. Its real cost (${formatUsd(g.actualUsd)}) took your spending to ${formatUsd(spentUsd)}, over your ${formatUsd(settings.budgetUsd)} limit.`;
  appendFeed(g.sessionId, { id: uid('fd'), createdAt: Date.now(), workspace: get().ui.workspace, type: 'notice', level: 'error', text, overLimitFor: { gen: g.id } });
}

/** "Ignore" on that warning: it stays as a record, without its actions. */
export function ignoreExcess(sessionId: string, itemId: string): void {
  updateFeedItem<NoticeFeedItem>(sessionId, itemId, (it) => ({ ...it, overLimitFor: it.overLimitFor && { ...it.overLimitFor, ignored: true } }));
}

/** A Nodes run that did not start: the real reason for the card (the limit, or the graph changed). */
export function rerunNote(e: Estimate): string {
  return overLimit(e) ? overLimitText(e) : 'The execution changed. Review and approve again.';
}
