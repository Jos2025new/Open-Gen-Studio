/* Store adapter for D+ approval tickets and paidSend (docs/diagnostico-dinero.md). */
import { AbortedError } from '../../lib/http';
import { uid } from '../../lib/id';
import { guard } from '../../lib/saveGuard';
import { holdsWriterLock } from '../../lib/writerLock';
import { saveStatus } from '../../store/saveStatus';
import { addSpend } from '../../store/spend';
import { appendFeed, patchGeneration, saveNow, upsertTicket, useStore } from '../../store/store';
import { OverLimitError } from '../budget';
import { isRestart } from '../checkStatus';
import { noAskDurable } from '../noAsk';
import { deliverSend, shareOfEstimate } from '../sendLedger';
import type { Estimate, Generation, RemoteJob, SendRecord, Workspace } from '../types';
import { paidSend, sendFree, PaidSendBlockedError, type BudgetSnapshot, type PaidSendOutcome, type PaidSendTransportResult, type SpendBooking, type TicketAccess } from './paidSend';
import {
  createTicket, estimatedPrice, exactPrice, FREE_PRICE, isFreePrice, isHeldStatus, isSendOut,
  markSendFailed, markSendSent, interruptSends, priceFromEstimate, roundUsd, settleSend,
  stepCommittedUsd, ticketCommittedUsd, ticketsInSessions, UNKNOWN_PRICE,
  type ApprovalTicket, type MoneyPrice, type TicketPass, type TicketSend,
} from './ticket';

const get = useStore.getState;
const NOT_SENT_MESSAGE = 'Not sent: could not save before sending. Nothing was charged; retry to try again.';
const PARTIAL_NOT_SENT_MESSAGE = 'Next request not sent: could not save before sending. Earlier items in this batch were already sent; retry to continue with the rest.';
const PRIOR_UNCERTAIN_NOT_SENT_MESSAGE = 'Not sent: could not save before sending. A previous request for this generation may have been charged; check before retrying.';

export class SendNotCommittedError extends Error {
  constructor(message = NOT_SENT_MESSAGE) { super(message); this.name = 'SendNotCommittedError'; }
}

export const generationTicketId = (genId: string): string => `gen:${genId}`;
const generationIdFromTicket = (id: string): string | undefined => (id.startsWith('gen:') ? id.slice(4) : undefined);

const toLegacySend = (s: TicketSend): SendRecord => ({
  id: s.id, index: s.index, status: s.status === 'in_flight' || s.status === 'pending' ? 'intent' : s.status,
  ...(s.remoteJob ? { remoteJob: s.remoteJob } : {}), ...(s.settledUsd != null ? { costUsd: s.settledUsd } : {}),
  ...(s.settledEstimated != null ? { estimated: s.settledEstimated } : {}), ...(s.bookedUsd != null ? { bookedUsd: s.bookedUsd } : {}),
  ...(s.bookedUnknown ? { bookedUnknown: true } : {}),
});

function projectTicketToGeneration(genId: string, sends: readonly TicketSend[]): void {
  const cur = sends.length ? get().generations[genId] : undefined;
  if (!cur) return;
  const ids = new Set(sends.map((s) => s.id));
  const visible = [...(cur.sends?.filter((s) => !ids.has(s.id)) ?? []), ...sends.filter((s) => s.status !== 'pending').map(toLegacySend)];
  const activeSent = sends.find((s) => s.status === 'sent' && s.remoteJob);
  const patch: Partial<Generation> = { sends: visible.length ? visible : undefined, sending: sends.find((s) => s.status === 'in_flight')?.updatedAt };
  if (activeSent?.remoteJob) {
    patch.remoteJob = activeSent.remoteJob; patch.jobId = activeSent.remoteJob.id; patch.lostJob = undefined;
    if (cur.sent) patch.sent = { ...cur.sent, jobId: activeSent.remoteJob.id };
  } else if (cur.status !== 'done' && sends.some((s) => s.status === 'uncertain')) patch.lostJob = true;
  patchGeneration(genId, patch);
}

export const storeTickets: TicketAccess = {
  get: (id) => get().tickets[id],
  list: () => { const { tickets, sessions } = get(); return ticketsInSessions(tickets, sessions); },
  put: (ticket) => {
    const prev = get().tickets[ticket.id];
    if (prev === ticket) return;
    upsertTicket(ticket);
    const legacyId = generationIdFromTicket(ticket.id);
    const changed = new Set(ticket.sends.flatMap((s, i) => { const gId = s.generationId ?? legacyId; return gId && s !== prev?.sends[i] ? [gId] : []; }));
    for (const gId of changed) projectTicketToGeneration(gId, sendsForGeneration(ticket, gId));
    if (ticket.sends.some((s, i) => s.status === 'uncertain' && s !== prev?.sends[i])) ensureUncertainChargeNotice(ticket);
  },
};

const isUncertainCharge = (t: ApprovalTicket, s: TicketSend) => s.status === 'uncertain' && (t.kind !== 'commands' || s.generationId != null);

export function ensureUncertainChargeNotice(ticket: ApprovalTicket): void {
  const send = ticket.sends.find((slot) => isUncertainCharge(ticket, slot));
  const feed = send && get().sessions[ticket.sessionId]?.feed;
  if (!send || !feed || feed.some((it) => it.type === 'notice' && (it.uncertainTicketId === ticket.id || it.uncertainLlmTicketId === ticket.id || (it.meta?.runId && `llm:${it.meta.runId}` === ticket.id)))) return;
  const origin = get().generations[send.generationId ?? generationIdFromTicket(ticket.id) ?? '']?.origin;
  const workspace: Workspace = origin === 'node' || origin === 'designer' ? origin : 'chat';
  appendFeed(ticket.sessionId, {
    id: uid('fd'), createdAt: Date.now(), workspace, type: 'notice', level: 'info', uncertainTicketId: ticket.id,
    ...(ticket.kind === 'llm' ? { uncertainLlmTicketId: ticket.id } : {}),
    text: 'An interrupted provider request may have been charged. Its amount is unknown.',
  });
}

export function reconcileUnknownCharge(sessionId: string, ticketId: string): boolean {
  const existing = storeTickets.get(ticketId);
  if (existing?.sessionId !== sessionId || !canWriteTicket()) return false;
  const uncertain = existing.sends.filter((s) => isUncertainCharge(existing, s));
  if (!uncertain.length) return false;
  let ticket = existing;
  for (const send of uncertain) {
    const settlement = settleSend(ticket, send.id, { costUsd: null, estimated: true });
    ticket = settlement.ticket;
    if (!settlement.bookedUnknown) continue;
    const g = get().generations[send.generationId ?? generationIdFromTicket(ticket.id) ?? ''];
    if (g) bookGenerationSpend(g, { ticketId, sendId: send.id, usd: null, estimated: true });
    else addSpend(null, { category: 'agent', provider: ticket.scope.llm?.provider ?? 'Unknown provider', model: ticket.scope.llm?.model ?? 'Unknown model', sessionId, estimated: true, sendId: send.id });
  }
  storeTickets.put(ticket);
  void saveTicketMark().catch(() => undefined);
  return true;
}

const ticketForGeneration = (genId: string): ApprovalTicket | undefined => {
  const { tickets, generations } = get();
  const approval = generations[genId]?.approvalTicketId;
  return (approval ? tickets[approval] : undefined) ?? tickets[generationTicketId(genId)];
};
const sendsForGeneration = (t: ApprovalTicket | undefined, genId: string): readonly TicketSend[] =>
  !t ? [] : t.id === generationTicketId(genId) ? t.sends : t.sends.filter((s) => s.generationId === genId);

export const canWriteTicket = (): boolean => holdsWriterLock() && !guard.discarding;
export async function saveTicketMark(): Promise<void> {
  const v = saveStatus.getState().version;
  await saveNow();
  if (!holdsWriterLock() || guard.discarding || saveStatus.getState().confirmed < v) throw new Error('save not confirmed');
}
export const budgetSnapshotFor = (sessionId: string): BudgetSnapshot => {
  const st = get();
  return { budgetOn: st.settings.budgetOn, budgetUsd: st.settings.budgetUsd, spentUsd: st.spentUsd, sessionNoAsk: noAskDurable(st, sessionId) };
};

export const sendStepKeyFor = (g: Pick<Generation, 'passStepKey' | 'planId' | 'origin' | 'stepId'>): string | undefined =>
  g.passStepKey ?? (g.planId && g.stepId ? g.stepId : g.origin === 'node' && g.stepId ? `node:${g.stepId}` : undefined);

export const stepCapFromEstimate = (estimate: Estimate): number | null | undefined => {
  const price = priceFromEstimate(estimate);
  return isFreePrice(price) ? undefined : price.maxVerifiableUsd;
};

export function stepCapsFromMap(perStep: Record<string, Estimate> | undefined, prefix = ''): Record<string, number | null> | undefined {
  if (!perStep) return undefined;
  const out: Record<string, number | null> = {};
  for (const [id, est] of Object.entries(perStep)) { const cap = stepCapFromEstimate(est); if (cap !== undefined) out[`${prefix}${id}`] = cap; }
  return Object.keys(out).length ? out : undefined;
}

export function ticketPassFromEstimate(estimate: Estimate, steps?: Record<string, number | null>): TicketPass {
  const price = priceFromEstimate(estimate), vals = steps ? Object.values(steps) : [], hasSteps = vals.length > 0;
  const allowUnknown = hasSteps ? vals.some((v) => v === null) : price.maxVerifiableUsd == null;
  const maxUsd = hasSteps ? (vals.some((v) => v !== null) ? roundUsd(vals.reduce<number>((s, v) => s + (v ?? 0), 0)) : null) : (price.maxVerifiableUsd ?? price.usd);
  return { kind: 'once', maxUsd, ...(allowUnknown ? { allowUnknown: true } : {}), ...(hasSteps ? { steps: { ...steps } } : {}) };
}

export function ensureGenerationTicket(g: Generation, opts: { pass?: TicketPass } = {}): ApprovalTicket {
  const id = generationTicketId(g.id), existing = ticketForGeneration(g.id);
  if (existing) {
    if (opts.pass === undefined) return existing;
    const updated = { ...existing, ...(existing.id === id ? { price: priceFromEstimate(g.estimate) } : {}), pass: opts.pass };
    upsertTicket(updated);
    return updated;
  }
  const created = createTicket({ id, sessionId: g.sessionId, kind: 'generation', price: priceFromEstimate(g.estimate), ...(opts.pass ? { pass: opts.pass } : {}) });
  upsertTicket(created);
  return created;
}

export function grantTicketPass(ticket: ApprovalTicket, estimate: Estimate, steps?: Record<string, number | null>): ApprovalTicket {
  if (steps && Object.keys(steps).length) {
    const merged: Record<string, number | null> = { ...(ticket.pass?.steps ?? {}) };
    const unknownGrants: Record<string, number> = { ...(ticket.pass?.unknownGrants ?? {}) };
    for (const [key, cap] of Object.entries(steps)) {
      if (cap === null) {
        merged[key] = null;
        const priorOut = new Set(ticket.sends.filter((s) => s.stepKey === key && isSendOut(s.status)).map((s) => s.generationId ?? s.id)).size;
        if (priorOut > 0) unknownGrants[key] = priorOut + 1;
      } else merged[key] = roundUsd(stepCommittedUsd(ticket, key) + cap);
    }
    const updated = { ...ticket, pass: { ...ticketPassFromEstimate(estimate, merged), ...(Object.keys(unknownGrants).length ? { unknownGrants } : {}) } };
    storeTickets.put(updated);
    return updated;
  }
  const pass = ticketPassFromEstimate(estimate);
  const updated = { ...ticket, pass: { ...pass, maxUsd: pass.maxUsd == null ? null : roundUsd(ticketCommittedUsd(ticket) + pass.maxUsd) } };
  storeTickets.put(updated);
  return updated;
}

export function grantGenerationTicketPass(genId: string, estimate: Estimate): void {
  const g = get().generations[genId];
  if (!g) return;
  const ticket = ensureGenerationTicket(g), stepKey = sendStepKeyFor(g), cap = stepCapFromEstimate(estimate);
  if (stepKey && (ticket.pass?.steps || ticket.kind !== 'generation') && cap !== undefined) grantTicketPass(ticket, estimate, { [stepKey]: cap });
  else grantTicketPass(ticket, estimate);
}

export function slotPriceForGeneration(g: Pick<Generation, 'provider' | 'modelRef' | 'estimate' | 'retryBaseEstimate' | 'retryTotal' | 'variants' | 'assetIds' | 'settings'>, items = 1, quote?: number | null): MoneyPrice {
  if (g.provider === 'local' || g.modelRef.startsWith('local::')) return FREE_PRICE;
  if (quote != null && Number.isFinite(quote) && quote >= 0) return exactPrice(quote);
  if (g.estimate?.usd === 0 && !g.estimate.lowerBound && (quote == null || quote === 0)) return FREE_PRICE;
  const share = shareOfEstimate(g as Generation, items);
  if (share == null || !Number.isFinite(share)) return UNKNOWN_PRICE;
  return g.estimate?.lowerBound ? estimatedPrice(share, { lowerBound: true }) : g.estimate?.approximate ? estimatedPrice(share) : exactPrice(share);
}

function notSentMessage(g: Generation | undefined, reqId?: string): string {
  if (!g) return NOT_SENT_MESSAGE;
  const sends = generationSends(g);
  if ((g.assetIds.length > 0 && !g.parentId) || sends.some((s) => s.id !== reqId && (s.status === 'done' || s.status === 'sent' || s.status === 'failed'))) return PARTIAL_NOT_SENT_MESSAGE;
  return g.lostJob || g.remoteJob || sends.some((s) => s.id !== reqId && (s.status === 'uncertain' || s.remoteJob)) ? PRIOR_UNCERTAIN_NOT_SENT_MESSAGE : NOT_SENT_MESSAGE;
}

const bookGenerationSpend = (g: Generation, b: SpendBooking) => addSpend(b.usd, { category: g.kind, provider: g.modelRef.split('::')[0], model: g.modelRef, sessionId: g.sessionId, estimated: b.estimated, sendId: b.sendId });

export interface GenerationPaidSendOpts<T> {
  readonly g: Generation; readonly index: number; readonly items?: number; readonly quote?: number | null;
  readonly signal: AbortSignal; readonly beforeTransport?: () => void; readonly isRetryable?: (err: unknown) => boolean;
  readonly send: (ctx: { sendId: string; onRemoteJob: (job: RemoteJob) => void }) => Promise<PaidSendTransportResult<T>>;
}

export async function sendGenerationViaPaidGate<T>(opts: GenerationPaidSendOpts<T>): Promise<PaidSendOutcome<T>> {
  const { g, index, items = 1, quote, signal, beforeTransport, isRetryable, send } = opts;
  const price = slotPriceForGeneration(g, items, quote), sendId = uid('req'), existing = ticketForGeneration(g.id);
  const accepted = sendsForGeneration(existing, g.id).some((s) => s.index === index && isSendOut(s.status)) || (get().generations[g.id] ?? g).sends?.some((s) => s.index === index && s.status !== 'failed');
  if (accepted) throw new PaidSendBlockedError('ALREADY_SENT', 'This request may already have been charged.', { ticketId: existing?.id ?? generationTicketId(g.id), sendId });
  try {
    if (isFreePrice(price)) {
      void saveNow().catch(() => undefined);
      return await sendFree(sendId, send, signal, beforeTransport, (r, cost) => { deliverSend(g.id, sendId, index, cost, Boolean(r.estimated)); });
    }
    const ticket = ensureGenerationTicket(g), slotKey = g.id + ':' + index, stepKey = sendStepKeyFor(g);
    return await paidSend<T>({
      ticketId: ticket.id, prepare: { id: sendId, slotKey, ...(stepKey ? { stepKey } : {}), index, price, generationId: g.id, ...(g.origin === 'node' && g.stepId ? { nodeId: g.stepId } : {}) },
      tickets: storeTickets, lockKeys: [slotKey], getBudget: () => budgetSnapshotFor(g.sessionId), save: saveTicketMark, canWrite: canWriteTicket,
      onBookSpend: (b) => { bookGenerationSpend(get().generations[g.id] ?? g, b); }, beforeTransport, send, signal, restart: () => isRestart(signal.reason), isRetryable,
    });
  } catch (err) {
    throw legacyPaidSendError(err, price, () => notSentMessage(get().generations[g.id] ?? g, sendId));
  }
}

export function legacyPaidSendError(err: unknown, price: MoneyPrice, saveError?: () => string): unknown {
  if (!(err instanceof PaidSendBlockedError)) return err;
  if (err.code === 'SAVE_FAILED') return new SendNotCommittedError(saveError?.());
  if (err.code === 'ABORTED') return new AbortedError();
  if (err.code === 'OVER_LIMIT' || err.code === 'UNKNOWN_PRICE' || err.code === 'PASS_EXCEEDED') {
    const extra = price.lowerBound ? { lowerBound: true } : price.usd != null && price.maxVerifiableUsd == null ? { unbounded: true } : {};
    return new OverLimitError({ usd: price.usd, approximate: price.kind !== 'exact', ...extra });
  }
  return err;
}

type GenerationSendState = Pick<Generation, 'id' | 'sends'>;
const generationSends = (g: GenerationSendState) => { const s = sendsForGeneration(ticketForGeneration(g.id), g.id); return s.length ? s : g.sends ?? []; };
const unacknowledged = (s: { status: string }) => s.status === 'in_flight' || s.status === 'intent' || s.status === 'uncertain';
const findRemoteSend = (t: ApprovalTicket | undefined, genId: string, job: RemoteJob) => sendsForGeneration(t, genId).find((s) => s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider);

export const hasActiveTicketSend = (g: Generation): boolean => { const s = sendsForGeneration(ticketForGeneration(g.id), g.id); return Boolean(g.lostJob || (s.length ? s.some((x) => isHeldStatus(x.status)) : g.remoteJob || g.sending != null || g.sends?.some((x) => unacknowledged(x) || x.status === 'sent'))); };
export const hasUncertainTicketSend = (g: Generation): boolean => { const s = sendsForGeneration(ticketForGeneration(g.id), g.id); return s.length ? s.some((x) => x.status === 'uncertain') : Boolean(g.lostJob || g.sends?.some((x) => x.status === 'uncertain')); };
export const hasUnstoredPaidResult = (g: Pick<Generation, 'kind' | 'status' | 'assetIds' | 'text'>, sends: readonly { status: string; index: number }[]): boolean => g.status !== 'done' && sends.some((s) => s.status === 'done' && (g.kind === 'text' ? g.text === undefined : s.index >= g.assetIds.length));
export const hasOpenInFlightSend = (g: Generation): boolean => { const s = sendsForGeneration(ticketForGeneration(g.id), g.id); return s.length ? s.some(unacknowledged) : g.sending != null || Boolean(g.sends?.some(unacknowledged)); };
export const wasFreeTicketSend = (g: GenerationSendState & Pick<Generation, 'provider' | 'modelRef' | 'estimate'>, freeAtSend = false): boolean =>
  generationSends(g).some((s) => unacknowledged(s) && (!('price' in s) || !isFreePrice(s.price))) ? false : freeAtSend || g.provider === 'local' || g.modelRef.startsWith('local::') || (g.estimate?.usd === 0 && !g.estimate.lowerBound);
export const activeTicketRemoteJob = (g: Generation): RemoteJob | undefined =>
  sendsForGeneration(ticketForGeneration(g.id), g.id).find((s) => s.status === 'sent' && s.remoteJob)?.remoteJob ?? g.remoteJob ?? g.sends?.find((s) => s.status === 'sent' && s.remoteJob)?.remoteJob;

export function adoptRecoveredJobOnTicket(genId: string, job: RemoteJob): boolean {
  const t = ticketForGeneration(genId), open = sendsForGeneration(t, genId).find((s) => !s.remoteJob && (s.status === 'uncertain' || s.status === 'in_flight'));
  if (!t || !open) return false;
  storeTickets.put(markSendSent(t, open.id, job));
  return true;
}

export const isRemoteJobDelivered = (g: Generation, job: RemoteJob): boolean => {
  const send = generationSends(g).find((s) => s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider);
  return Boolean(send?.status === 'done' && !hasUnstoredPaidResult(g, [send]));
};

export function settleTicketRemoteSend(genId: string, job: RemoteJob, costUsd: number | null | undefined, estimated: boolean): string | undefined {
  const t = ticketForGeneration(genId), g = get().generations[genId], match = findRemoteSend(t, genId, job);
  if (!t || !g || !match) return undefined;
  const settled = settleSend(t, match.id, { costUsd, estimated });
  storeTickets.put(settled.ticket);
  if (!settled.alreadyBooked && (settled.bookedDeltaUsd > 0 || settled.bookedUnknown)) {
    bookGenerationSpend(g, { ticketId: t.id, sendId: match.id, usd: settled.bookedUnknown ? null : settled.bookedDeltaUsd, estimated: settled.bookedUnknown ? true : estimated });
  }
  return match.id;
}

export function failTicketRemoteJob(genId: string, job: RemoteJob, error?: string): boolean {
  const t = ticketForGeneration(genId), match = findRemoteSend(t, genId, job);
  if (!t || !match || match.status === 'done' || match.status === 'failed') return false;
  storeTickets.put(markSendFailed(t, match.id, error));
  return true;
}

export function interruptTicketOnReload(g: Generation, job: RemoteJob | undefined): { handled: boolean; maybeCharged: boolean } {
  const t = ticketForGeneration(g.id), sends = sendsForGeneration(t, g.id);
  if (!t || !sends.length) return { handled: false, maybeCharged: false };
  const next = job ? t : interruptSends(t, (s) => sends.includes(s) && !s.remoteJob);
  storeTickets.put(next);
  const updated = sendsForGeneration(next, g.id);
  const midLocalStore = !job && !wasFreeTicketSend(g) && ((g.sending != null && g.assetIds.length === 0) || hasUnstoredPaidResult(g, updated));
  return { handled: true, maybeCharged: !job && (updated.some((s) => s.status === 'uncertain') || midLocalStore) };
}

export const hasLlmPossibleCharge = (runId: string | undefined): boolean => {
  const status = runId && storeTickets.get(`llm:${runId}`)?.sends.at(-1)?.status;
  return status === 'in_flight' || status === 'uncertain';
};
