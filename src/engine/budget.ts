import { localTimeZone } from './feedMeta';
import { placeFor } from './place';
import { formatUsd } from '../lib/format';
import { uid } from '../lib/id';
import { appendFeed, patchSession, setUi, updateFeedItem, useStore } from '../store/store';
import type { Estimate, LlmProviderId, NoticeFeedItem } from './types';
import { noAskDurable, noAskEverywhere, setUntilNextGrant, untilNextGrant, untilNextHolds, type UntilNextGrant } from './noAsk';

export { noAskEverywhere };

/*
 * The spending limit warns, it does not block: with no limit, or once the user chose to go past it, runs go
 * ahead and spending is only shown. What is already running is never stopped for its cost.
 */

const get = useStore.getState;

/** Money left under the limit, or null when there is no limit. */
export function remainingBudget(state: { settings: { budgetOn: boolean; budgetUsd: number }; spentUsd: number } = get()): number | null {
  const { settings, spentUsd } = state;
  return settings.budgetOn ? settings.budgetUsd - spentUsd : null;
}

/**
 * "Continue once": a pass per session that lives exactly as long as the approved action (withOncePass). It is also spent
 * when that action creates its first generation (so a batch such as Run all, approved once, is one run). Painting never
 * spends it. If the action ends without creating one (the graph changed, a recovery was refused, an error), it dies with it.
 */
const oncePasses = new Map<string, Set<symbol>>();
/** Sequence-level passes for "Allow this time": each grant stays alive across all spend steps of its sequence until ended. */
const sequencePasses = new Map<string, Set<symbol>>();
/** Approved multi-step batches (Nodes runs): scoped to one run's steps so unrelated sends still ask. */
const approvedBatches = new Map<symbol, { sessionId: string; steps: Set<string> }>();

function addPass(store: Map<string, Set<symbol>>, sessionId: string, token: symbol): void {
  let tokens = store.get(sessionId);
  if (!tokens) {
    tokens = new Set();
    store.set(sessionId, tokens);
  }
  tokens.add(token);
}

function removePass(store: Map<string, Set<symbol>>, sessionId: string, token: symbol): void {
  const tokens = store.get(sessionId);
  if (!tokens) return;
  tokens.delete(token);
  if (tokens.size === 0) store.delete(sessionId);
}

function runWithPass<T>(end: () => void, action: () => T): T {
  let result: T;
  try { result = action(); } catch (e) { end(); throw e; }
  if (result instanceof Promise) return result.finally(end) as T;
  end();
  return result;
}
/**
 * "Don't ask again until next session" (user decision 2026-11-14): covers every session while the chat the user was in
 * when they chose it stays the open one. It ends when the user opens a chat in another session, when the spending limit
 * changes, or when the user turns it off (`askAgain`). The rule is `untilNextSessionStillHolds`: change it there.
 */
const untilNextListeners = new Set<() => void>();
const notifyUntilNext = () => untilNextListeners.forEach((fn) => fn());

function untilNextSessionStillHolds(grant: UntilNextGrant): boolean {
  return untilNextHolds(get(), grant);
}

let unwatchUntilNext: (() => void) | null = null;
function endUntilNextSession(): void {
  unwatchUntilNext?.();
  unwatchUntilNext = null;
  if (untilNextGrant()) {
    setUntilNextGrant(null);
    notifyUntilNext();
  }
}

/** Is "until next session" on right now? */
export function untilNextSessionActive(): boolean {
  const grant = untilNextGrant();
  if (grant && !untilNextSessionStillHolds(grant)) endUntilNextSession();
  return untilNextGrant() !== null;
}

/** For `useSyncExternalStore`: tells when "until next session" turns on or off. */
export function subscribeUntilNextSession(fn: () => void): () => void {
  untilNextListeners.add(fn);
  return () => void untilNextListeners.delete(fn);
}

/** Over-limit runs go ahead without asking: no limit, "Don't ask in any session" (or a limit accepted by an older version), this session's "Don't ask again", "Don't ask again until next session", or a pass just given. */
export function overLimitAccepted(sessionId?: string): boolean {
  const { budgetOn } = get().settings;
  return !budgetOn || noAskDurable(get(), sessionId) || passFor(sessionId ?? get().activeSessionId);
}

function passFor(sessionId: string): boolean {
  return (oncePasses.get(sessionId)?.size ?? 0) > 0 || (sequencePasses.get(sessionId)?.size ?? 0) > 0;
}

/** The approved action started spending: the pass is used up. */
export function consumeOnce(sessionId: string): void {
  oncePasses.delete(sessionId);
}

/** This run would go over an active limit nobody agreed to go past. An unknown price cannot be checked against it, so it asks too. */
export function overLimit(e: Estimate, sessionId?: string): boolean {
  const left = remainingBudget();
  return left != null && !overLimitAccepted(sessionId) && (e.usd == null || e.usd > left + 1e-9);
}

/** A send that would pass the spending limit and nobody agreed: createGeneration refuses it (the safety net behind every entry). */
export class OverLimitError extends Error {
  constructor(readonly estimate: Estimate) {
    super(overLimitText(estimate));
    this.name = 'OverLimitError';
  }
}

/**
 * The central check of the promise «new paid runs will ask first»: an entry that forgot to ask is stopped here.
 * Free runs and approved plan steps go through. For other runs, use the same rule as the entries: a price that
 * exceeds the remaining budget or is unpublished needs approval when the limit is active.
 */
export function assertWithinLimit(e: Estimate, sessionId: string, approvedByPlan: boolean): void {
  if (approvedByPlan || e.usd === 0 || !overLimit(e, sessionId)) return;
  throw new OverLimitError(e);
}

/** What the confirmation says when a run goes over the limit. */
export function overLimitText(e: Estimate, choices = '“Continue once” lets only this run through; “Don\u2019t ask again” stops asking in this session. Nothing running is stopped.'): string {
  const { budgetUsd } = get().settings;
  const left = Math.max(0, remainingBudget() ?? 0);
  if (e.usd == null) return `The price of this run is not published, so it cannot be checked against your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left). The real cost can pass it. ${choices}`;
  return `Goes over your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left, this costs ${formatUsd(e.usd)}). ${choices}`;
}

/**
 * "Continue once": run the approved action with this session's pass, and retire the pass when the action ends, finishes
 * or fails, whether or not it created a generation. The next run that goes over asks again.
 */
export function withOncePass<T>(sessionId: string, action: () => T): T {
  const token = Symbol();
  addPass(oncePasses, sessionId, token);
  return runWithPass(() => removePass(oncePasses, sessionId, token), action);
}

/**
 * "Allow this time": grants a sequence-level pass for `sessionId` until the returned cleanup function is called.
 */
export function beginOncePass(sessionId: string): () => void {
  const token = Symbol();
  addPass(sequencePasses, sessionId, token);
  return () => removePass(sequencePasses, sessionId, token);
}

/**
 * Cover every step of an approved multi-step Nodes run. Spends any once-pass for `sessionId` immediately so
 * unrelated runs in the same session still ask while this batch is executing.
 */
export function beginBatchPass(sessionId: string, stepIds: Iterable<string>): { token: symbol; end: () => void } {
  consumeOnce(sessionId);
  const token = Symbol('batch');
  approvedBatches.set(token, { sessionId, steps: new Set(stepIds) });
  return { token, end: () => void approvedBatches.delete(token) };
}

/** True while `stepId` belongs to a running approved batch for `sessionId`. */
export function batchStepApproved(sessionId: string, token: symbol | undefined, stepId: string | undefined): boolean {
  if (!token || !stepId) return false;
  const batch = approvedBatches.get(token);
  return Boolean(batch && batch.sessionId === sessionId && batch.steps.has(stepId));
}

/** "Don't ask again" / "Allow for the whole session": this run goes ahead and so do the rest of this session's. Other sessions still ask. */
export function dontAskAgain(sessionId: string = get().activeSessionId): void {
  patchSession(sessionId, (s) => ({ ...s, noAskOverLimit: true }));
}


/** "Don't ask again until next session": see `untilNextSessionStillHolds` for how long it lasts. */
export function dontAskUntilNextSession(): void {
  endUntilNextSession();
  const { settings, activeSessionId } = get();
  setUntilNextGrant({ chat: activeSessionId, budgetOn: settings.budgetOn, budgetUsd: settings.budgetUsd });
  // Eager end: leaving the chat and coming back must not bring it back.
  unwatchUntilNext = useStore.subscribe(() => {
    const grant = untilNextGrant();
    if (grant && !untilNextSessionStillHolds(grant)) endUntilNextSession();
  });
  notifyUntilNext();
}

/** "Ask again": this session asks once more. */
export function askAgain(sessionId: string = get().activeSessionId): void {
  oncePasses.delete(sessionId);
  sequencePasses.delete(sessionId);
  endUntilNextSession();
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
  const ws = get().ui.workspace;
  appendFeed(g.sessionId, { id: uid('fd'), createdAt: Date.now(), workspace: ws, type: 'notice', level: 'error', text, overLimitFor: { gen: g.id }, meta: { timeZone: localTimeZone(), space: placeFor(get().ui, ws) } });
}

/** "Ignore" on that warning: it stays as a record, without its actions. */
export function ignoreExcess(sessionId: string, itemId: string): void {
  updateFeedItem<NoticeFeedItem>(sessionId, itemId, (it) => ({ ...it, overLimitFor: it.overLimitFor && { ...it.overLimitFor, ignored: true } }));
}

/** A Nodes run that did not start: the real reason for the card (the limit, or the graph changed). */
export function rerunNote(e: Estimate, sessionId?: string): string {
  return overLimit(e, sessionId) ? overLimitText(e) : 'The execution changed. Review and approve again.';
}

/** Nominal cost estimate for one LLM call so `overLimit` can guard LLM entries before tokens are known. */
export function llmCallEstimate(provider: LlmProviderId, model: string): Estimate {
  const m = get().catalog.llm[provider]?.find((x) => x.id === model);
  if (m && m.inputPrice === 0 && m.outputPrice === 0) return { usd: 0, approximate: false };
  const raw = ((m?.inputPrice ?? 0) * 1000 + (m?.outputPrice ?? 0) * 500) / 1_000_000;
  return { usd: Math.max(0.0001, Math.round(raw * 10000) / 10000), approximate: true };
}
