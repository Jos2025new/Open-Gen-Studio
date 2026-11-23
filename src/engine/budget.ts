/* Spending limit verdict, durable session grants, and unified ticket-pass bridge. */
import { localTimeZone } from './feedMeta';
import { placeFor } from './place';
import { formatUsd } from '../lib/format';
import { uid } from '../lib/id';
import { appendFeed, patchSession, setUi, updateFeedItem, useStore } from '../store/store';
import type { Estimate, LlmProviderId, NoticeFeedItem } from './types';
import { noAskDurable, noAskEverywhere, setUntilNextGrant, untilNextGrant, untilNextHolds } from './noAsk';
import { ledgerCost } from './sendLedger';
import { formatSpendAmount } from './spending';
import { availableBudgetUsd, isFreePrice, priceFromEstimate, ticketsInSessions, type ApprovalTicket } from './money/ticket';
import { evaluateBudgetGate } from './money/paidSend';

export { noAskEverywhere };
const get = useStore.getState;

export const remainingBudget = (state: { settings: { budgetOn: boolean; budgetUsd: number }; spentUsd: number; tickets?: Record<string, ApprovalTicket>; generations?: Record<string, unknown>; sessions?: Record<string, unknown> } = get()): number | null =>
  state.settings.budgetOn ? availableBudgetUsd(state.settings.budgetUsd, state.spentUsd, ticketsInSessions(state.tickets, state.sessions)) : null;

export interface BudgetPass { readonly sessionId: string; readonly kind: 'once' | 'sequence' | 'ticket'; readonly ticketId?: string; readonly stepKey?: string }
export interface BudgetPassHandle { readonly pass: BudgetPass; end: () => void }
export interface BudgetVerdict { over: boolean; remaining: number | null; unknownPrice: boolean; text?: string }
export const ticketBudgetPass = (sessionId: string, ticketId: string, stepKey?: string): BudgetPass =>
  Object.freeze({ sessionId, kind: 'ticket' as const, ticketId, ...(stepKey ? { stepKey } : {}) });

type GenerationPassEntry = { sessionId: string; budgetUsd: number; approvedUsd: number | null; started: boolean; owner?: BudgetPass | string; deferred?: boolean };
type PassEntry = { remainingUsd: number; unknownRemaining: number };
const activePasses = new Map<BudgetPass, PassEntry>();
const substitutePasses = new Map<string, GenerationPassEntry>();

const releaseUnstartedOwned = (owner: BudgetPass | string) => { for (const [id, e] of substitutePasses) if (e.owner === owner && !e.started) substitutePasses.delete(id); };
export const releaseOwnedPasses = (owner: string): void => releaseUnstartedOwned(owner);
const passHolds = (pass: BudgetPass | undefined, sid: string) => Boolean(pass && pass.sessionId === sid && activePasses.has(pass));
const hasUnknownPrice = (e: Estimate) => e.usd == null || Boolean(e.lowerBound || e.unbounded);
const covers = (entry: PassEntry, e: Estimate) => { const u = e.usd ?? 0; return (!hasUnknownPrice(e) || entry.unknownRemaining > 0) && Number.isFinite(u) && u >= 0 && u <= entry.remainingUsd + 1e-9; };

const untilNextListeners = new Set<() => void>();
let unwatchUntilNext: (() => void) | null = null;
function endUntilNextSession(): void {
  unwatchUntilNext?.(); unwatchUntilNext = null;
  if (untilNextGrant()) { setUntilNextGrant(null); untilNextListeners.forEach((fn) => fn()); }
}
export function untilNextSessionActive(): boolean {
  const g = untilNextGrant();
  if (g && !untilNextHolds(get(), g)) endUntilNextSession();
  return untilNextGrant() !== null;
}
export const subscribeUntilNextSession = (fn: () => void): (() => void) => { untilNextListeners.add(fn); return () => void untilNextListeners.delete(fn); };

export function overLimitAccepted(sessionId?: string, pass?: BudgetPass): boolean {
  const sid = sessionId ?? get().activeSessionId;
  return !get().settings.budgetOn || noAskDurable(get(), sid) || passHolds(pass, sid);
}

export function passActiveFor(pass: BudgetPass | undefined, sessionId: string, estimate?: Estimate): boolean {
  if (!pass) return false;
  if (pass.kind === 'ticket') {
    const t = pass.sessionId === sessionId && pass.ticketId ? get().tickets[pass.ticketId] : undefined;
    return Boolean(t && !t.closed && t.sessionId === sessionId && t.pass?.kind === 'once' && (!estimate || !budgetVerdict(estimate, { sessionId, pass }).over));
  }
  return Boolean(passHolds(pass, sessionId) && (!estimate || covers(activePasses.get(pass)!, estimate)));
}

export function consumeOnce(pass?: BudgetPass, estimate?: Estimate): void {
  if (!pass || pass.kind === 'ticket') return;
  const entry = activePasses.get(pass);
  if (!entry) return;
  if (pass.kind === 'once') activePasses.delete(pass);
  else if (estimate && covers(entry, estimate)) { entry.remainingUsd -= estimate.usd ?? 0; if (hasUnknownPrice(estimate)) entry.unknownRemaining--; }
}

export function budgetVerdict(e: Estimate, opts: { sessionId?: string; pass?: BudgetPass; choices?: string } = {}): BudgetVerdict {
  const st = get(), { settings, spentUsd, sessions, tickets, activeSessionId } = st;
  const price = priceFromEstimate(e), sid = opts.sessionId ?? activeSessionId, allTickets = ticketsInSessions(tickets, sessions);
  const t = opts.pass?.kind === 'ticket' && opts.pass.sessionId === sid && opts.pass.ticketId ? tickets[opts.pass.ticketId] : undefined;
  const ticket = t?.sessionId === sid ? t : undefined;
  const verdict = evaluateBudgetGate({
    ...(ticket ? { ticket, stepKey: opts.pass?.stepKey } : {}),
    price,
    budget: { ...settings, spentUsd, sessionNoAsk: noAskDurable(st, sid) || (opts.pass?.kind !== 'ticket' && passActiveFor(opts.pass, sid, e)) },
    allTickets,
  });
  const remaining = settings.budgetOn ? verdict.remainingUsd ?? availableBudgetUsd(settings.budgetUsd, spentUsd, allTickets) : null;
  return { over: !verdict.ok, remaining, unknownPrice: price.maxVerifiableUsd == null, ...(!verdict.ok ? { text: overLimitText(e, opts.choices) } : {}) };
}

export const overLimit = (e: Estimate, sessionId?: string, pass?: BudgetPass): boolean => budgetVerdict(e, { sessionId, pass }).over;
export const budgetProblem = (e: Estimate, sessionId?: string, pass?: BudgetPass): string | null => budgetVerdict(e, { sessionId, pass }).text ?? null;

export function budgetProblemForSteps(estimate: Estimate, perStep: Record<string, Estimate> | undefined, sessionId: string, pass?: BudgetPass, prefix = ''): string | null {
  if (pass?.kind === 'ticket' && perStep) {
    for (const [id, est] of Object.entries(perStep)) {
      if (isFreePrice(priceFromEstimate(est))) continue;
      const problem = budgetProblem(est, sessionId, ticketBudgetPass(pass.sessionId, pass.ticketId!, `${prefix}node:${id}`));
      if (problem) return problem;
    }
    return null;
  }
  return budgetProblem(estimate, sessionId, pass);
}

export class OverLimitError extends Error {
  constructor(readonly estimate: Estimate) { super(overLimitText(estimate)); this.name = 'OverLimitError'; }
}

export function assertWithinLimit(e: Estimate, sessionId: string, approvedByPlan: boolean, pass?: BudgetPass): void {
  if (approvedByPlan || (e.usd === 0 && !e.lowerBound) || !budgetVerdict(e, { sessionId, pass }).over) return;
  throw new OverLimitError(e);
}

export function overLimitText(e: Estimate, choices = '“Continue once” lets only this run through; “Don\u2019t ask again” stops asking in this session. Nothing running is stopped.'): string {
  const { budgetUsd } = get().settings, left = Math.max(0, remainingBudget() ?? 0);
  if (e.usd == null) return `The price of this run is unknown, so it cannot be checked against your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left). The real cost can pass it. ${choices}`;
  if (e.unbounded) return `This run is estimated at ${formatUsd(e.usd)} without a verifiable maximum. It can pass your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left). ${choices}`;
  if (e.lowerBound && e.usd <= left + 1e-9) return `Only a minimum price (${formatUsd(e.usd)}) is published, so it cannot be checked against your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left). The real cost can pass it. ${choices}`;
  return `Goes over your ${formatUsd(budgetUsd)} limit (${formatUsd(left)} left, this costs ${formatUsd(e.usd)}). ${choices}`;
}

export function withOncePass<T>(sessionId: string, action: (pass: BudgetPass) => T, approvedUsd: number | null, lowerBound = false): T {
  const pass: BudgetPass = Object.freeze({ sessionId, kind: 'once' });
  activePasses.set(pass, { remainingUsd: approvedUsd ?? 0, unknownRemaining: approvedUsd == null || lowerBound ? 1 : 0 });
  const end = () => { activePasses.delete(pass); releaseUnstartedOwned(pass); };
  let res: T;
  try { res = action(pass); } catch (e) { end(); throw e; }
  if (res instanceof Promise) return res.finally(end) as T;
  end();
  return res;
}

export function beginOncePass(sessionId: string, approvedUsd: number | null, unknownSteps = approvedUsd == null ? 1 : 0): BudgetPassHandle {
  const pass: BudgetPass = Object.freeze({ sessionId, kind: 'sequence' });
  activePasses.set(pass, { remainingUsd: approvedUsd ?? 0, unknownRemaining: unknownSteps });
  return { pass, end: () => { activePasses.delete(pass); releaseUnstartedOwned(pass); } };
}

export function withSequenceStepPass<T>(pass: BudgetPass, sessionId: string, estimate: Estimate, reviewed: Estimate | undefined, action: (stepPass?: BudgetPass) => T): T {
  if (passActiveFor(pass, sessionId, estimate) && (!hasUnknownPrice(estimate) || (reviewed && hasUnknownPrice(reviewed)))) {
    consumeOnce(pass, estimate);
    return withOncePass(sessionId, action, estimate.usd, estimate.lowerBound);
  }
  assertWithinLimit(estimate, sessionId, false);
  return action();
}

export function bindGenerationPass(generationId: string, sessionId: string, approvedUsd: number | null, owner?: BudgetPass | string): void {
  substitutePasses.set(generationId, { sessionId, budgetUsd: get().settings.budgetUsd, approvedUsd: approvedUsd != null && Number.isFinite(approvedUsd) ? approvedUsd : null, started: false, owner });
}
export const startGenerationPass = (id: string): void => { const e = substitutePasses.get(id); if (e) e.started = true; };
export const deferGenerationPass = (id: string): void => { const e = substitutePasses.get(id); if (e) e.deferred = true; };
export const clearGenerationPass = (id: string, force = false): void => { const e = substitutePasses.get(id); if (e && (force || !e.deferred)) substitutePasses.delete(id); };
export function clearSessionPasses(sessionId: string): void {
  for (const pass of activePasses.keys()) if (pass.sessionId === sessionId) activePasses.delete(pass);
  for (const [id, entry] of substitutePasses) if (entry.sessionId === sessionId) substitutePasses.delete(id);
}

export function takeGenerationPass(generationId: string, estimate: Estimate): BudgetPass | undefined {
  const entry = substitutePasses.get(generationId);
  if (!entry) return undefined;
  substitutePasses.delete(generationId);
  const st = get(), g = st.generations[generationId];
  if (!g || g.status === 'canceled' || !st.sessions[entry.sessionId]) return undefined;
  if (st.settings.budgetOn && st.settings.budgetUsd !== entry.budgetUsd) return undefined;
  if (entry.approvedUsd == null || estimate.usd == null || estimate.lowerBound || !Number.isFinite(estimate.usd)) return undefined;
  const booked = g.sends?.some((s) => s.status === 'done') ? ledgerCost(g) : undefined;
  if (booked?.hasUnknown || estimate.usd > entry.approvedUsd - (booked?.usd ?? 0) + 1e-9) return undefined;
  const pass: BudgetPass = Object.freeze({ sessionId: entry.sessionId, kind: 'once' });
  activePasses.set(pass, { remainingUsd: estimate.usd, unknownRemaining: 0 });
  return pass;
}

export const dontAskAgain = (sessionId: string = get().activeSessionId): void => { patchSession(sessionId, (s) => ({ ...s, noAskOverLimit: true })); };
export function dontAskUntilNextSession(): void {
  endUntilNextSession();
  const { settings, activeSessionId } = get();
  setUntilNextGrant({ chat: activeSessionId, budgetOn: settings.budgetOn, budgetUsd: settings.budgetUsd });
  unwatchUntilNext = useStore.subscribe(() => { const g = untilNextGrant(); if (g && !untilNextHolds(get(), g)) endUntilNextSession(); });
  untilNextListeners.forEach((fn) => fn());
}
export function askAgain(sessionId: string = get().activeSessionId): void {
  clearSessionPasses(sessionId); endUntilNextSession();
  patchSession(sessionId, (s) => ({ ...s, noAskOverLimit: false }));
}
export function openBudgetSettings(): void {
  try { localStorage.setItem('ogs:settings-tab', JSON.stringify('budget')); } catch { /* storage unavailable */ }
  setUi({ settingsOpen: true });
}

export function noteExcess(generationId: string): void {
  const { settings, spentUsd, sessions, generations } = get(), g = generations[generationId], session = g && sessions[g.sessionId];
  if (!g || g.estimate.usd != null || !settings.budgetOn || !session || spentUsd <= settings.budgetUsd + 1e-9) return;
  const booked = g.sends?.some((s) => s.status === 'done') ? ledgerCost(g) : undefined, partial = Boolean(booked?.hasUnknown);
  const reportedUsd = partial ? (booked!.usd > 0 ? booked!.usd : undefined) : g.actualUsd;
  if (reportedUsd == null || session.feed.some((f) => f.type === 'notice' && f.overLimitFor?.gen === g.id)) return;
  const what = g.prompt.trim().slice(0, 40) || g.kind, ws = get().ui.workspace;
  const text = partial
    ? `“${what}” had no published price. Its known charges (${formatSpendAmount(reportedUsd, { unknown: true })}) took your spending to ${formatSpendAmount(spentUsd, { unknown: true })}, over your ${formatUsd(settings.budgetUsd)} limit.`
    : `“${what}” had no published price. Its real cost (${formatUsd(reportedUsd)}) took your spending to ${formatUsd(spentUsd)}, over your ${formatUsd(settings.budgetUsd)} limit.`;
  appendFeed(g.sessionId, { id: uid('fd'), createdAt: Date.now(), workspace: ws, type: 'notice', level: 'error', text, overLimitFor: { gen: g.id }, meta: { timeZone: localTimeZone(), space: placeFor(get().ui, ws) } });
}

export const ignoreExcess = (sessionId: string, itemId: string): void => { updateFeedItem<NoticeFeedItem>(sessionId, itemId, (it) => ({ ...it, overLimitFor: it.overLimitFor && { ...it.overLimitFor, ignored: true } })); };
export const rerunNote = (e: Estimate, sessionId?: string): string => budgetVerdict(e, { sessionId }).text ?? 'The execution changed. Review and approve again.';

export function llmCallEstimate(provider: LlmProviderId, model: string): Estimate {
  const m = get().catalog.llm[provider]?.find((x) => x.id === model);
  if (m?.inputPrice == null || m.outputPrice == null || !Number.isFinite(m.inputPrice) || !Number.isFinite(m.outputPrice)) return { usd: null, approximate: true };
  if (m.inputPrice === 0 && m.outputPrice === 0) return { usd: 0, approximate: false };
  return { usd: Math.max(0.0001, Math.round(((m.inputPrice * 1000 + m.outputPrice * 500) / 1_000_000) * 10000) / 10000), approximate: true, unbounded: true };
}
