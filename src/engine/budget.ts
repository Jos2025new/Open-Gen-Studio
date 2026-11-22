import { localTimeZone } from './feedMeta';
import { placeFor } from './place';
import { formatUsd } from '../lib/format';
import { uid } from '../lib/id';
import { appendFeed, patchSession, setUi, updateFeedItem, useStore } from '../store/store';
import type { Estimate, LlmProviderId, NoticeFeedItem } from './types';
import { noAskDurable, noAskEverywhere, setUntilNextGrant, untilNextGrant, untilNextHolds, type UntilNextGrant } from './noAsk';
import { ledgerCost } from './sendLedger';
import { formatSpendAmount } from './spending';

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
 * Unforgeable in-memory pass owned by one approved action (never a session-wide grant, never persisted).
 * Another action in the same session neither sees it nor spends it.
 */
export interface BudgetPass {
  readonly sessionId: string;
  readonly kind: 'once' | 'sequence';
}

export interface BudgetPassHandle {
  readonly pass: BudgetPass;
  end: () => void;
}

export interface BudgetVerdict {
  /** Would go over an active limit without a matching durable rule or action pass. */
  over: boolean;
  /** Remaining budget in USD, or null when the spending limit is off. */
  remaining: number | null;
  /** True when the price is not published (`usd == null`). */
  unknownPrice: boolean;
  /** Ready-to-show warning copy when `over` is true. */
  text?: string;
}

type GenerationPassEntry = {
  sessionId: string;
  budgetUsd: number;
  started: boolean;
  owner?: BudgetPass | symbol;
};

/** Active passes keyed by object identity so forged objects are rejected and reload clears everything. */
const activePasses = new Map<BudgetPass, { sessionId: string; kind: 'once' | 'sequence' }>();
/** One-shot in-memory entitlement for a same-price 402 substitute of a generation approved with a pass (not in activePasses until taken). */
const substitutePasses = new Map<string, GenerationPassEntry>();
/** Approved multi-step batches (Nodes runs): scoped to one run's steps so unrelated sends still ask. */
const approvedBatches = new Map<symbol, { sessionId: string; steps: Set<string>; hadPass: boolean }>();

function releaseUnstartedOwned(owner: BudgetPass | symbol): void {
  for (const [genId, entry] of substitutePasses) {
    if (entry.owner === owner && !entry.started) substitutePasses.delete(genId);
  }
}

function passHolds(pass: BudgetPass | undefined, sessionId: string): boolean {
  if (!pass) return false;
  const entry = activePasses.get(pass);
  return Boolean(entry && entry.sessionId === sessionId);
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

/** Over-limit runs go ahead without asking: no limit, "Don't ask in any session" (or a limit accepted by an older version), this session's "Don't ask again", "Don't ask again until next session", or this action's own active pass. */
export function overLimitAccepted(sessionId?: string, pass?: BudgetPass): boolean {
  const { budgetOn } = get().settings;
  const sid = sessionId ?? get().activeSessionId;
  return !budgetOn || noAskDurable(get(), sid) || passHolds(pass, sid);
}

/** True when `pass` is currently active for `sessionId`. */
export function passActiveFor(pass: BudgetPass | undefined, sessionId: string): boolean {
  return passHolds(pass, sessionId);
}

/** The approved action started spending: retire its own once-pass (sequence passes stay alive until ended). */
export function consumeOnce(pass?: BudgetPass): void {
  if (!pass) return;
  const entry = activePasses.get(pass);
  if (entry && entry.kind === 'once') activePasses.delete(pass);
}

/**
 * The single spending-limit rule. Free runs ($0) never go over; an unknown price cannot be checked against an active
 * limit, so it asks too. A `pass` applies only to the action carrying it and only for its own session.
 */
export function budgetVerdict(
  e: Estimate,
  opts: { sessionId?: string; pass?: BudgetPass; choices?: string } = {},
): BudgetVerdict {
  const remaining = remainingBudget();
  const unknownPrice = e.usd == null;
  if (e.usd === 0) return { over: false, remaining, unknownPrice: false };
  const sid = opts.sessionId ?? get().activeSessionId;
  const accepted = overLimitAccepted(sid, opts.pass);
  const over = remaining != null && !accepted && (unknownPrice || e.usd! > remaining + 1e-9);
  return { over, remaining, unknownPrice, ...(over ? { text: overLimitText(e, opts.choices) } : {}) };
}

/** This run would go over an active limit nobody agreed to go past. Delegates to `budgetVerdict`. */
export function overLimit(e: Estimate, sessionId?: string, pass?: BudgetPass): boolean {
  return budgetVerdict(e, { sessionId, pass }).over;
}

/** Why a run needs confirmation: it goes over a limit not yet accepted. Null when allowed. */
export function budgetProblem(e: Estimate, sessionId?: string, pass?: BudgetPass): string | null {
  return budgetVerdict(e, { sessionId, pass }).text ?? null;
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
 * Free runs and approved plan steps go through. For other runs, use the same rule as the entries (`budgetVerdict`):
 * a price that exceeds the remaining budget or is unpublished needs approval when the limit is active.
 */
export function assertWithinLimit(e: Estimate, sessionId: string, approvedByPlan: boolean, pass?: BudgetPass): void {
  if (approvedByPlan || e.usd === 0 || !budgetVerdict(e, { sessionId, pass }).over) return;
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
 * "Continue once": run the approved action with its own pass, and retire the pass when the action ends, finishes
 * or fails, whether or not it created a generation. Unrelated actions in the same session never see it.
 */
export function withOncePass<T>(sessionId: string, action: (pass: BudgetPass) => T): T {
  const pass: BudgetPass = Object.freeze({ sessionId, kind: 'once' });
  activePasses.set(pass, { sessionId, kind: 'once' });
  return runWithPass(() => {
    activePasses.delete(pass);
    releaseUnstartedOwned(pass);
  }, () => action(pass));
}

/**
 * "Allow this time": grants a sequence-level pass for `sessionId` until `end()` is called. Only steps carrying
 * the returned `pass` see it; unrelated actions in the same session still ask.
 */
export function beginOncePass(sessionId: string): BudgetPassHandle {
  const pass: BudgetPass = Object.freeze({ sessionId, kind: 'sequence' });
  activePasses.set(pass, { sessionId, kind: 'sequence' });
  return {
    pass,
    end: () => {
      activePasses.delete(pass);
      releaseUnstartedOwned(pass);
    },
  };
}

/** Bind a one-shot in-memory entitlement to `generationId` so a same-price 402 substitute within the same run can proceed. */
export function bindGenerationPass(generationId: string, sessionId: string, owner?: BudgetPass | symbol): void {
  substitutePasses.set(generationId, {
    sessionId,
    budgetUsd: get().settings.budgetUsd,
    started: false,
    owner,
  });
}

/** Mark `generationId` as having started running so its 402 substitute entitlement outlives a fire-and-forget approving action. */
export function startGenerationPass(generationId: string): void {
  const entry = substitutePasses.get(generationId);
  if (entry) entry.started = true;
}

/** Take (and detach) the one-shot 402 substitute pass bound to `generationId`, activating it only while the generation and session live under the same limit. */
export function takeGenerationPass(generationId: string): BudgetPass | undefined {
  const entry = substitutePasses.get(generationId);
  if (!entry) return undefined;
  substitutePasses.delete(generationId);
  const st = get();
  const g = st.generations[generationId];
  if (!g || g.status === 'canceled' || !st.sessions[entry.sessionId]) return undefined;
  if (st.settings.budgetOn && st.settings.budgetUsd !== entry.budgetUsd) return undefined;
  const pass: BudgetPass = Object.freeze({ sessionId: entry.sessionId, kind: 'once' });
  activePasses.set(pass, { sessionId: entry.sessionId, kind: 'once' });
  return pass;
}

/** Retire any unused 402 substitute entitlement when `generationId` finishes, cancels or is deleted. */
export function clearGenerationPass(generationId: string): void {
  substitutePasses.delete(generationId);
}

/** Clear all in-memory passes and 402 substitute entitlements for `sessionId` (session closed/deleted or reset). */
export function clearSessionPasses(sessionId: string): void {
  for (const [pass, entry] of activePasses) {
    if (entry.sessionId === sessionId) activePasses.delete(pass);
  }
  for (const [genId, entry] of substitutePasses) {
    if (entry.sessionId === sessionId) substitutePasses.delete(genId);
  }
}

/**
 * Cover every step of an approved multi-step Nodes run. Spends the action's once-pass immediately so
 * unrelated runs in the same session still ask while this batch is executing.
 */
export function beginBatchPass(sessionId: string, stepIds: Iterable<string>, pass?: BudgetPass): { token: symbol; end: () => void } {
  const hadPass = passHolds(pass, sessionId);
  consumeOnce(pass);
  const token = Symbol('batch');
  approvedBatches.set(token, { sessionId, steps: new Set(stepIds), hadPass });
  return {
    token,
    end: () => {
      approvedBatches.delete(token);
      releaseUnstartedOwned(token);
    },
  };
}

/** True while `stepId` belongs to a running approved batch for `sessionId`. */
export function batchStepApproved(sessionId: string, token: symbol | undefined, stepId: string | undefined): boolean {
  if (!token || !stepId) return false;
  const batch = approvedBatches.get(token);
  return Boolean(batch && batch.sessionId === sessionId && batch.steps.has(stepId));
}

/** True when the approved batch covering `stepId` was started with a once-pass. */
export function batchStepHadPass(sessionId: string, token: symbol | undefined, stepId: string | undefined): boolean {
  if (!token || !stepId) return false;
  const batch = approvedBatches.get(token);
  return Boolean(batch && batch.sessionId === sessionId && batch.steps.has(stepId) && batch.hadPass);
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
  clearSessionPasses(sessionId);
  endUntilNextSession();
  patchSession(sessionId, (s) => ({ ...s, noAskOverLimit: false }));
}

/** Open Settings on the Budget tab. */
export function openBudgetSettings(): void {
  try { localStorage.setItem('ogs:settings-tab', JSON.stringify('budget')); } catch { /* storage unavailable */ }
  setUi({ settingsOpen: true });
}

/**
 * A run with an unknown price was let through; once its real (or partial known) cost is booked and the total is over
 * the limit, say so once, naming it. No margin: any excess counts. Never stops anything.
 */
export function noteExcess(generationId: string): void {
  const { settings, spentUsd, sessions, generations } = get();
  const g = generations[generationId];
  const session = g && sessions[g.sessionId];
  if (!g || g.estimate.usd != null || !settings.budgetOn || !session || spentUsd <= settings.budgetUsd + 1e-9) return;
  const booked = g.sends?.some((s) => s.status === 'done') ? ledgerCost(g) : undefined;
  const partial = Boolean(booked?.hasUnknown);
  const reportedUsd = partial ? (booked!.usd > 0 ? booked!.usd : undefined) : g.actualUsd;
  if (reportedUsd == null) return;
  if (session.feed.some((f) => f.type === 'notice' && f.overLimitFor?.gen === g.id)) return;
  const what = g.prompt.trim().slice(0, 40) || g.kind;
  const text = partial
    ? `“${what}” had no published price. Its known charges (${formatSpendAmount(reportedUsd, { unknown: true })}) took your spending to ${formatSpendAmount(spentUsd, { unknown: true })}, over your ${formatUsd(settings.budgetUsd)} limit.`
    : `“${what}” had no published price. Its real cost (${formatUsd(reportedUsd)}) took your spending to ${formatUsd(spentUsd)}, over your ${formatUsd(settings.budgetUsd)} limit.`;
  const ws = get().ui.workspace;
  appendFeed(g.sessionId, { id: uid('fd'), createdAt: Date.now(), workspace: ws, type: 'notice', level: 'error', text, overLimitFor: { gen: g.id }, meta: { timeZone: localTimeZone(), space: placeFor(get().ui, ws) } });
}

/** "Ignore" on that warning: it stays as a record, without its actions. */
export function ignoreExcess(sessionId: string, itemId: string): void {
  updateFeedItem<NoticeFeedItem>(sessionId, itemId, (it) => ({ ...it, overLimitFor: it.overLimitFor && { ...it.overLimitFor, ignored: true } }));
}

/** A Nodes run that did not start: the real reason for the card (the limit, or the graph changed). */
export function rerunNote(e: Estimate, sessionId?: string): string {
  return budgetVerdict(e, { sessionId }).text ?? 'The execution changed. Review and approve again.';
}

/** Nominal cost estimate for one LLM call so `budgetVerdict` can guard LLM entries before tokens are known. */
export function llmCallEstimate(provider: LlmProviderId, model: string): Estimate {
  const m = get().catalog.llm[provider]?.find((x) => x.id === model);
  if (m && m.inputPrice === 0 && m.outputPrice === 0) return { usd: 0, approximate: false };
  const raw = ((m?.inputPrice ?? 0) * 1000 + (m?.outputPrice ?? 0) * 500) / 1_000_000;
  return { usd: Math.max(0.0001, Math.round(raw * 10000) / 10000), approximate: true };
}
