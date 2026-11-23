import { localTimeZone } from './feedMeta';
import { placeFor } from './place';
import { formatUsd } from '../lib/format';
import { uid } from '../lib/id';
import { appendFeed, patchSession, setUi, updateFeedItem, useStore } from '../store/store';
import type { Estimate, LlmProviderId, NoticeFeedItem } from './types';
import { noAskDurable, noAskEverywhere, setUntilNextGrant, untilNextGrant, untilNextHolds, type UntilNextGrant } from './noAsk';
import { ledgerCost } from './sendLedger';
import { formatSpendAmount } from './spending';
import { priceFromEstimate, roundUsd, ticketsInSessions, totalReservedUsd, type ApprovalTicket } from './money/ticket';

export { noAskEverywhere };

/*
 * The spending limit warns, it does not block: with no limit, or once the user chose to go past it, runs go
 * ahead and spending is only shown. What is already running is never stopped for its cost.
 */

const get = useStore.getState;

/** Money left under the limit (after confirmed spend and open ticket reservations), or null when there is no limit. */
export function remainingBudget(
  state: {
    settings: { budgetOn: boolean; budgetUsd: number };
    spentUsd: number;
    tickets?: Record<string, ApprovalTicket>;
    generations?: Record<string, unknown>;
    sessions?: Record<string, unknown>;
  } = get(),
): number | null {
  const { settings, spentUsd, tickets, sessions } = state;
  if (!settings.budgetOn) return null;
  const reserved = totalReservedUsd(ticketsInSessions(tickets, sessions));
  return roundUsd(settings.budgetUsd - spentUsd - reserved);
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
  approvedUsd: number | null;
  quoteApprovedUsd: number | null;
  priorSendIds?: ReadonlySet<string>;
  started: boolean;
  owner?: BudgetPass | string;
  deferred?: boolean;
};

/** Active passes keyed by object identity so forged objects are rejected and reload clears everything. */
type PassEntry = { remainingUsd: number; unknownRemaining: number };
const activePasses = new Map<BudgetPass, PassEntry>();
/** One-shot in-memory entitlement for a same-price 402 substitute of a generation approved with a pass (not in activePasses until taken). */
const substitutePasses = new Map<string, GenerationPassEntry>();

function releaseUnstartedOwned(owner: BudgetPass | string): void {
  for (const [genId, entry] of substitutePasses) {
    if (entry.owner === owner && !entry.started) substitutePasses.delete(genId);
  }
}

/** Retire unstarted 402 substitute passes owned by a finished node-run ticket. */
export function releaseOwnedPasses(owner: string): void {
  releaseUnstartedOwned(owner);
}

function passHolds(pass: BudgetPass | undefined, sessionId: string): boolean {
  return Boolean(pass && pass.sessionId === sessionId && activePasses.has(pass));
}

const hasUnknownPrice = (estimate: Estimate) => estimate.usd == null || Boolean(estimate.lowerBound || estimate.unbounded);

function covers(entry: PassEntry, estimate: Estimate): boolean {
  const usd = estimate.usd ?? 0;
  return (!hasUnknownPrice(estimate) || entry.unknownRemaining > 0)
    && Number.isFinite(usd) && usd >= 0 && usd <= entry.remainingUsd + 1e-9;
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
export function passActiveFor(pass: BudgetPass | undefined, sessionId: string, estimate?: Estimate): boolean {
  return Boolean(pass && passHolds(pass, sessionId) && (!estimate || covers(activePasses.get(pass)!, estimate)));
}

/** Reserve the cost at execution. Price previews only read the pass. */
export function consumeOnce(pass?: BudgetPass, estimate?: Estimate): void {
  if (!pass) return;
  const entry = activePasses.get(pass);
  if (!entry) return;
  if (pass.kind === 'once') activePasses.delete(pass);
  else if (estimate && covers(entry, estimate)) {
    entry.remainingUsd -= estimate.usd ?? 0;
    if (hasUnknownPrice(estimate)) entry.unknownRemaining--;
  }
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
  const price = priceFromEstimate(e);
  if (price.kind === 'exact' && price.usd === 0) return { over: false, remaining, unknownPrice: false };
  const unknownPrice = price.maxVerifiableUsd == null;
  const sid = opts.sessionId ?? get().activeSessionId;
  const accepted = overLimitAccepted(sid) || passActiveFor(opts.pass, sid, e);
  const over = remaining != null && !accepted && (unknownPrice || price.maxVerifiableUsd! > remaining + 1e-9);
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
 * a price that exceeds the remaining budget or is unknown needs approval when the limit is active.
 */
export function assertWithinLimit(e: Estimate, sessionId: string, approvedByPlan: boolean, pass?: BudgetPass): void {
  if (approvedByPlan || (e.usd === 0 && !e.lowerBound) || !budgetVerdict(e, { sessionId, pass }).over) return;
  throw new OverLimitError(e);
}

/** What the confirmation says when a run goes over the limit. */
export function overLimitText(e: Estimate, choices = '“Continue once” lets only this run through; “Don\u2019t ask again” stops asking in this session. Nothing running is stopped.'): string {
  const { budgetUsd } = get().settings;
  const left = Math.max(0, remainingBudget() ?? 0);
  if (e.usd == null) return `The price of this run is unknown, so it cannot be checked against your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left). The real cost can pass it. ${choices}`;
  if (e.unbounded) return `This run is estimated at ${formatUsd(e.usd)} without a verifiable maximum. It can pass your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left). ${choices}`;
  if (e.lowerBound && e.usd <= left + 1e-9) return `Only a minimum price (${formatUsd(e.usd)}) is published, so it cannot be checked against your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left). The real cost can pass it. ${choices}`;
  return `Goes over your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left, this costs ${formatUsd(e.usd)}). ${choices}`;
}

/**
 * "Continue once": run the approved action with its own pass, and retire the pass when the action ends, finishes
 * or fails, whether or not it created a generation. Unrelated actions in the same session never see it.
 */
export function withOncePass<T>(sessionId: string, action: (pass: BudgetPass) => T, approvedUsd: number | null, lowerBound = false): T {
  const pass: BudgetPass = Object.freeze({ sessionId, kind: 'once' });
  activePasses.set(pass, { remainingUsd: approvedUsd ?? 0, unknownRemaining: approvedUsd == null || lowerBound ? 1 : 0 });
  return runWithPass(() => {
    activePasses.delete(pass);
    releaseUnstartedOwned(pass);
  }, () => action(pass));
}

/**
 * "Allow this time": grants a sequence-level pass for `sessionId` until `end()` is called. Only steps carrying
 * the returned `pass` see it; unrelated actions in the same session still ask.
 */
export function beginOncePass(sessionId: string, approvedUsd: number | null, unknownSteps = approvedUsd == null ? 1 : 0): BudgetPassHandle {
  const pass: BudgetPass = Object.freeze({ sessionId, kind: 'sequence' });
  activePasses.set(pass, { remainingUsd: approvedUsd ?? 0, unknownRemaining: unknownSteps });
  return {
    pass,
    end: () => {
      activePasses.delete(pass);
      releaseUnstartedOwned(pass);
    },
  };
}

/** Allocate part of a sequence's approval to one command. Unknown prices must have been shown for that step. */
export function withSequenceStepPass<T>(
  pass: BudgetPass, sessionId: string, estimate: Estimate, reviewed: Estimate | undefined, action: (stepPass?: BudgetPass) => T,
): T {
  if (passActiveFor(pass, sessionId, estimate) && (!hasUnknownPrice(estimate) || (reviewed && hasUnknownPrice(reviewed)))) {
    consumeOnce(pass, estimate);
    return withOncePass(sessionId, action, estimate.usd, estimate.lowerBound);
  }
  assertWithinLimit(estimate, sessionId, false);
  return action();
}

/** Bind a one-shot in-memory entitlement to `generationId` so a 402 substitute within the approved amount can proceed. */
export function bindGenerationPass(
  generationId: string,
  sessionId: string,
  approvedUsd: number | null,
  owner?: BudgetPass | string,
): void {
  const amount = approvedUsd != null && Number.isFinite(approvedUsd) ? approvedUsd : null;
  const once = typeof owner === 'object' && owner.kind === 'once' ? activePasses.get(owner) : undefined;
  substitutePasses.set(generationId, {
    sessionId,
    budgetUsd: get().settings.budgetUsd,
    approvedUsd: amount,
    quoteApprovedUsd: amount == null ? null : once?.remainingUsd ?? amount,
    started: false,
    owner,
  });
}

/** Mark `generationId` as having started running so its 402 substitute entitlement outlives a fire-and-forget approving action. */
export function startGenerationPass(generationId: string): void {
  const entry = substitutePasses.get(generationId);
  if (entry) entry.started = true;
}

/** Retain the claimed approval while asynchronous preparation fetches a final quote. */
export function generationQuoteGuard(generationId: string): (usd: number | null) => void {
  const entry = substitutePasses.get(generationId);
  return (usd) => {
    if (!entry || usd == null) return;
    const sends = get().generations[generationId]?.sends;
    const prior = entry.priorSendIds;
    const booked = ledgerCost({ sends: prior ? sends?.filter(send => !prior.has(send.id)) : sends });
    const covered = entry.quoteApprovedUsd != null && !booked.hasUnknown && usd <= entry.quoteApprovedUsd - booked.usd + 1e-9;
    assertWithinLimit({ usd, approximate: false, exact: true }, entry.sessionId, covered);
  };
}

/** Carry an approved substitute's remaining amount to the final quote without granting another substitute. */
export function bindRetryQuoteApproval(generationId: string, estimate: Estimate, pass?: BudgetPass): void {
  const g = get().generations[generationId];
  if (!g || !pass || !passActiveFor(pass, g.sessionId, estimate)) return;
  const known = !hasUnknownPrice(estimate);
  const remaining = pass.kind === 'once' ? activePasses.get(pass)!.remainingUsd : estimate.usd;
  substitutePasses.set(generationId, {
    sessionId: g.sessionId,
    budgetUsd: get().settings.budgetUsd,
    approvedUsd: null,
    quoteApprovedUsd: known ? remaining : null,
    priorSendIds: new Set(g.sends?.filter(send => send.status === 'done').map(send => send.id)),
    started: true,
  });
  consumeOnce(pass, estimate);
}

/** Take (and detach) the one-shot 402 substitute pass bound to `generationId`, activating it only while the generation and session live under the same limit and `estimate` is known and within the approved amount. */
export function takeGenerationPass(generationId: string, estimate: Estimate): BudgetPass | undefined {
  const entry = substitutePasses.get(generationId);
  if (!entry) return undefined;
  substitutePasses.delete(generationId);
  const st = get();
  const g = st.generations[generationId];
  if (!g || g.status === 'canceled' || !st.sessions[entry.sessionId]) return undefined;
  if (st.settings.budgetOn && st.settings.budgetUsd !== entry.budgetUsd) return undefined;
  if (entry.approvedUsd == null || estimate.usd == null || estimate.lowerBound || !Number.isFinite(estimate.usd)) return undefined;
  const booked = g.sends?.some((s) => s.status === 'done') ? ledgerCost(g) : undefined;
  if (booked?.hasUnknown) return undefined;
  if (estimate.usd > entry.approvedUsd - (booked?.usd ?? 0) + 1e-9) return undefined;
  const pass: BudgetPass = Object.freeze({ sessionId: entry.sessionId, kind: 'once' });
  activePasses.set(pass, { remainingUsd: estimate.usd, unknownRemaining: 0 });
  return pass;
}

/** Keep `generationId`'s 402 substitute entitlement past `runGeneration.finally` while a same-price `ask` alert awaits the user's reply. */
export function deferGenerationPass(generationId: string): void {
  const entry = substitutePasses.get(generationId);
  if (entry) entry.deferred = true;
}

/** Retire any unused 402 substitute entitlement when `generationId` finishes, cancels or is deleted. */
export function clearGenerationPass(generationId: string, force = false): void {
  const entry = substitutePasses.get(generationId);
  if (!entry) return;
  if (!force && entry.deferred) return;
  substitutePasses.delete(generationId);
}

/** Clear all in-memory passes and 402 substitute entitlements for `sessionId` (session closed/deleted or reset). */
export function clearSessionPasses(sessionId: string): void {
  for (const pass of activePasses.keys()) {
    if (pass.sessionId === sessionId) activePasses.delete(pass);
  }
  for (const [genId, entry] of substitutePasses) {
    if (entry.sessionId === sessionId) substitutePasses.delete(genId);
  }
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
  if (m?.inputPrice == null || m.outputPrice == null || !Number.isFinite(m.inputPrice) || !Number.isFinite(m.outputPrice)) return { usd: null, approximate: true };
  if (m.inputPrice === 0 && m.outputPrice === 0) return { usd: 0, approximate: false };
  const raw = (m.inputPrice * 1000 + m.outputPrice * 500) / 1_000_000;
  return { usd: Math.max(0.0001, Math.round(raw * 10000) / 10000), approximate: true, unbounded: true };
}
