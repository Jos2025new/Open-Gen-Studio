/*
 * Store adapter for D+ approval tickets and paidSend (docs/diagnostico-dinero.md).
 * `useStore.tickets` is the sole authoritative source for in-flight reservations, slot state and
 * idempotent spend booking. Writes to a generation ticket project a read-only derived view onto
 * `Generation` (`sends`, `sending`, `remoteJob`, `jobId`, `lostJob`) so untouched UI components,
 * legacy recovery paths and existing tests keep working without maintaining a second decision engine.
 */
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
import {
  paidSend,
  sendFree,
  PaidSendBlockedError,
  type BudgetSnapshot,
  type PaidSendOutcome,
  type PaidSendTransportResult,
  type SpendBooking,
  type TicketAccess,
} from './paidSend';
import {
  createTicket,
  estimatedPrice,
  exactPrice,
  FREE_PRICE,
  isFreePrice,
  isHeldStatus,
  markSendFailed,
  markSendSent,
  interruptSends,
  priceFromEstimate,
  roundUsd,
  settleSend,
  isSendOut,
  ticketCommittedUsd,
  ticketsInSessions,
  UNKNOWN_PRICE,
  type ApprovalTicket,
  type MoneyPrice,
  type TicketPass,
  type TicketSend,
} from './ticket';

const get = useStore.getState;

const NOT_SENT_MESSAGE = 'Not sent: could not save before sending. Nothing was charged; retry to try again.';
const PARTIAL_NOT_SENT_MESSAGE = 'Next request not sent: could not save before sending. Earlier items in this batch were already sent; retry to continue with the rest.';
const PRIOR_UNCERTAIN_NOT_SENT_MESSAGE = 'Not sent: could not save before sending. A previous request for this generation may have been charged; check before retrying.';

/** Thrown when pre-send persistence or lock/discard guards fail before calling a provider. */
export class SendNotCommittedError extends Error {
  constructor(message = NOT_SENT_MESSAGE) {
    super(message);
    this.name = 'SendNotCommittedError';
  }
}

export function generationTicketId(genId: string): string {
  return `gen:${genId}`;
}

function generationIdFromTicket(ticketId: string): string | undefined {
  return ticketId.startsWith('gen:') ? ticketId.slice(4) : undefined;
}

function toLegacySend(s: TicketSend): SendRecord {
  const status: SendRecord['status'] = s.status === 'in_flight' || s.status === 'pending' ? 'intent' : s.status;
  return {
    id: s.id,
    index: s.index,
    status,
    ...(s.remoteJob ? { remoteJob: s.remoteJob } : {}),
    ...(s.settledUsd != null ? { costUsd: s.settledUsd } : {}),
    ...(s.settledEstimated != null ? { estimated: s.settledEstimated } : {}),
    ...(s.bookedUsd != null ? { bookedUsd: s.bookedUsd } : {}),
    ...(s.bookedUnknown ? { bookedUnknown: true } : {}),
  };
}

/**
 * One-way derived projection from `ApprovalTicket` onto `Generation`.
 * Never reads back from `Generation` to decide — keeps untouched UI and legacy readers in sync.
 */
function projectTicketToGeneration(genId: string, sends: readonly TicketSend[]): void {
  if (!sends.length) return;
  const cur = get().generations[genId];
  if (!cur) return;

  const ticketSendIds = new Set(sends.map((send) => send.id));
  const legacy = cur.sends?.filter((send) => !ticketSendIds.has(send.id)) ?? [];
  const visible = [...legacy, ...sends.filter((send) => send.status !== 'pending').map(toLegacySend)];
  const inFlight = sends.find((s) => s.status === 'in_flight');
  const activeSent = sends.find((s) => s.status === 'sent' && s.remoteJob);
  const hasUncertain = cur.status !== 'done' && sends.some((s) => s.status === 'uncertain');

  const patch: Partial<Generation> = {
    sends: visible.length ? visible : undefined,
    sending: inFlight ? inFlight.updatedAt : undefined,
  };
  if (activeSent?.remoteJob) {
    patch.remoteJob = activeSent.remoteJob;
    patch.jobId = activeSent.remoteJob.id;
    patch.lostJob = undefined;
    if (cur.sent) patch.sent = { ...cur.sent, jobId: activeSent.remoteJob.id };
  } else if (hasUncertain) {
    patch.lostJob = true;
  }
  patchGeneration(genId, patch);
}

/** Authoritative `TicketAccess` backed by `useStore.tickets` with one-way projection onto `Generation`. */
export const storeTickets: TicketAccess = {
  get: (ticketId) => get().tickets[ticketId],
  list: () => { const { tickets, sessions } = get(); return ticketsInSessions(tickets, sessions); },
  put: (ticket) => {
    const previous = get().tickets[ticket.id];
    if (previous === ticket) return;
    upsertTicket(ticket);
    const legacyId = generationIdFromTicket(ticket.id);
    const changed = new Set(ticket.sends.flatMap((send, index) => {
      const genId = send.generationId ?? legacyId;
      return genId && send !== previous?.sends[index] ? [genId] : [];
    }));
    for (const genId of changed) projectTicketToGeneration(genId, sendsForGeneration(ticket, genId));
    if (ticket.sends.some((send, index) => send.status === 'uncertain' && send !== previous?.sends[index])) ensureUncertainChargeNotice(ticket);
  },
};

function isUncertainCharge(ticket: ApprovalTicket, send: TicketSend): boolean {
  return send.status === 'uncertain' && (ticket.kind !== 'commands' || send.generationId != null);
}

/** Keep a durable way to release an uncertain reservation even after Retry or reload. */
export function ensureUncertainChargeNotice(ticket: ApprovalTicket): void {
  const send = ticket.sends.find((slot) => isUncertainCharge(ticket, slot));
  if (!send) return;
  const feed = get().sessions[ticket.sessionId]?.feed;
  if (!feed || feed.some((item) => item.type === 'notice' &&
    (item.uncertainTicketId === ticket.id || item.uncertainLlmTicketId === ticket.id ||
      (item.meta?.runId && `llm:${item.meta.runId}` === ticket.id)))) return;
  const genId = send.generationId ?? generationIdFromTicket(ticket.id);
  const origin = genId ? get().generations[genId]?.origin : undefined;
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
  const uncertain = existing.sends.filter(send => isUncertainCharge(existing, send));
  if (!uncertain.length) return false;
  let ticket = existing;
  for (const send of uncertain) {
    const settlement = settleSend(ticket, send.id, { costUsd: null, estimated: true });
    ticket = settlement.ticket;
    if (!settlement.bookedUnknown) continue;
    const genId = send.generationId ?? generationIdFromTicket(ticket.id);
    const g = genId ? get().generations[genId] : undefined;
    if (g) {
      bookGenerationSpend(g, { ticketId, sendId: send.id, usd: null, estimated: true });
    } else {
      const source = ticket.scope.llm;
      addSpend(null, {
        category: 'agent', provider: source?.provider ?? 'Unknown provider', model: source?.model ?? 'Unknown model',
        sessionId, estimated: true, sendId: send.id,
      });
    }
  }
  storeTickets.put(ticket);
  void saveTicketMark().catch(() => undefined);
  return true;
}

function ticketForGeneration(genId: string): ApprovalTicket | undefined {
  const { tickets, generations } = get();
  const approval = generations[genId]?.approvalTicketId;
  return (approval ? tickets[approval] : undefined) ?? tickets[generationTicketId(genId)];
}

function sendsForGeneration(ticket: ApprovalTicket | undefined, genId: string): readonly TicketSend[] {
  if (!ticket) return [];
  if (ticket.id === generationTicketId(genId)) return ticket.sends;
  return ticket.sends.filter((send) => send.generationId === genId);
}

export function canWriteTicket(): boolean {
  return holdsWriterLock() && !guard.discarding;
}

/** Persist the store and confirm the version written before `saveNow()` actually landed while locked and not discarding. */
export async function saveTicketMark(): Promise<void> {
  const targetVersion = saveStatus.getState().version;
  await saveNow();
  if (!holdsWriterLock() || guard.discarding || saveStatus.getState().confirmed < targetVersion) {
    throw new Error('save not confirmed');
  }
}

export function budgetSnapshotFor(sessionId: string): BudgetSnapshot {
  const st = get();
  return {
    budgetOn: st.settings.budgetOn,
    budgetUsd: st.settings.budgetUsd,
    spentUsd: st.spentUsd,
    sessionNoAsk: noAskDurable(st, sessionId),
  };
}

export function ticketPassFromEstimate(estimate: Estimate): TicketPass {
  const maxUsd = priceFromEstimate(estimate).maxVerifiableUsd;
  return {
    kind: 'once',
    maxUsd,
    ...(maxUsd == null ? { allowUnknown: true } : {}),
  };
}

/** Ensure a generation has an authoritative ticket in `useStore.tickets` without touching legacy `g.sends`. */
export function ensureGenerationTicket(
  g: Generation,
  opts: { pass?: TicketPass } = {},
): ApprovalTicket {
  const id = generationTicketId(g.id);
  const existing = ticketForGeneration(g.id);
  if (existing) {
    if (opts.pass !== undefined) {
      const updated: ApprovalTicket = { ...existing, ...(existing.id === id ? { price: priceFromEstimate(g.estimate) } : {}), pass: opts.pass };
      upsertTicket(updated);
      return updated;
    }
    return existing;
  }
  const created = createTicket({
    id,
    sessionId: g.sessionId,
    kind: 'generation',
    price: priceFromEstimate(g.estimate),
    ...(opts.pass ? { pass: opts.pass } : {}),
  });
  upsertTicket(created);
  return created;
}

export function grantTicketPass(ticket: ApprovalTicket, estimate: Estimate): ApprovalTicket {
  const pass = ticketPassFromEstimate(estimate);
  const updated = { ...ticket, pass: { ...pass, maxUsd: pass.maxUsd == null ? null : roundUsd(ticketCommittedUsd(ticket) + pass.maxUsd) } };
  storeTickets.put(updated);
  return updated;
}

export function grantGenerationTicketPass(genId: string, estimate: Estimate): void {
  const g = get().generations[genId];
  if (g) grantTicketPass(ensureGenerationTicket(g), estimate);
}

/** Compute the per-send `MoneyPrice`, respecting local/free models, explicit quotes and proportional batch estimates. */
export function slotPriceForGeneration(
  g: Pick<Generation, 'provider' | 'modelRef' | 'estimate' | 'retryBaseEstimate' | 'retryTotal' | 'variants' | 'assetIds' | 'settings'>,
  items = 1,
  quote?: number | null,
): MoneyPrice {
  if (g.provider === 'local' || g.modelRef.startsWith('local::')) return FREE_PRICE;
  if (quote != null && Number.isFinite(quote) && quote >= 0) return exactPrice(quote);
  if (g.estimate?.usd === 0 && !g.estimate.lowerBound && (quote == null || quote === 0)) return FREE_PRICE;
  const share = shareOfEstimate(g as Generation, items);
  if (share == null || !Number.isFinite(share)) return UNKNOWN_PRICE;
  if (g.estimate?.lowerBound) return estimatedPrice(share, { lowerBound: true });
  return g.estimate?.approximate ? estimatedPrice(share) : exactPrice(share);
}

/** Contextual message when pre-send durable persistence fails (preserves partial-batch and prior-uncertain warnings). */
function notSentMessage(g: Generation | undefined, reqId?: string): string {
  if (!g) return NOT_SENT_MESSAGE;
  const sends = generationSends(g);
  if ((g.assetIds.length > 0 && !g.parentId) ||
      sends.some(s => s.id !== reqId && (s.status === 'done' || s.status === 'sent' || s.status === 'failed'))) {
    return PARTIAL_NOT_SENT_MESSAGE;
  }
  return g.lostJob || g.remoteJob || sends.some(s => s.id !== reqId && (s.status === 'uncertain' || s.remoteJob))
    ? PRIOR_UNCERTAIN_NOT_SENT_MESSAGE : NOT_SENT_MESSAGE;
}

function bookGenerationSpend(g: Generation, booking: SpendBooking): void {
  addSpend(booking.usd, {
    category: g.kind,
    provider: g.modelRef.split('::')[0],
    model: g.modelRef,
    sessionId: g.sessionId,
    estimated: booking.estimated,
    sendId: booking.sendId,
  });
}

export interface GenerationPaidSendOpts<T> {
  readonly g: Generation;
  readonly index: number;
  readonly items?: number;
  readonly quote?: number | null;
  readonly signal: AbortSignal;
  readonly beforeTransport?: () => void;
  readonly isRetryable?: (err: unknown) => boolean;
  readonly send: (ctx: { sendId: string; onRemoteJob: (job: RemoteJob) => void }) => Promise<PaidSendTransportResult<T>>;
}

/**
 * Execute one transport call for a generation through `paidSend`: single lock, synchronous reservation,
 * 8 s durable save, pre-transport authorization hook, and idempotent settlement by `sendId`.
 */
export async function sendGenerationViaPaidGate<T>(opts: GenerationPaidSendOpts<T>): Promise<PaidSendOutcome<T>> {
  const { g, index, items = 1, quote, signal, beforeTransport, isRetryable, send } = opts;
  const price = slotPriceForGeneration(g, items, quote);
  const sendId = uid('req');
  const existing = ticketForGeneration(g.id);
  const accepted = sendsForGeneration(existing, g.id).some((slot) => slot.index === index && isSendOut(slot.status))
    || (get().generations[g.id] ?? g).sends?.some((slot) => slot.index === index && slot.status !== 'failed');
  if (accepted) throw new PaidSendBlockedError('ALREADY_SENT', 'This request may already have been charged.', { ticketId: existing?.id ?? generationTicketId(g.id), sendId });
  try {
    if (isFreePrice(price)) {
      void saveNow().catch(() => undefined);
      return await sendFree(sendId, send, signal, beforeTransport, (result, cost) => {
        deliverSend(g.id, sendId, index, cost, Boolean(result.estimated));
      });
    }
    const ticket = ensureGenerationTicket(g);
    const slotKey = g.id + ':' + index;
    return await paidSend<T>({
      ticketId: ticket.id,
      prepare: {
        id: sendId,
        slotKey,
        index,
        price,
        generationId: g.id,
        ...(g.origin === 'node' && g.stepId ? { nodeId: g.stepId } : {}),
      },
      tickets: storeTickets,
      lockKeys: [slotKey],
      getBudget: () => budgetSnapshotFor(g.sessionId),
      save: saveTicketMark,
      canWrite: canWriteTicket,
      onBookSpend: (booking) => {
        const latest = get().generations[g.id] ?? g;
        bookGenerationSpend(latest, booking);
      },
      beforeTransport,
      send,
      signal,
      restart: () => isRestart(signal.reason),
      isRetryable,
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
    return new OverLimitError({ usd: price.usd, approximate: price.kind !== 'exact', ...(price.lowerBound ? { lowerBound: true } : price.usd != null && price.maxVerifiableUsd == null ? { unbounded: true } : {}) });
  }
  return err;
}

type GenerationSendState = Pick<Generation, 'id' | 'sends'>;

function generationSends(g: GenerationSendState) {
  const sends = sendsForGeneration(ticketForGeneration(g.id), g.id);
  return sends.length ? sends : g.sends ?? [];
}

const unacknowledged = (send: { status: string }) =>
  send.status === 'in_flight' || send.status === 'intent' || send.status === 'uncertain';

export function hasActiveTicketSend(g: Generation): boolean {
  const sends = sendsForGeneration(ticketForGeneration(g.id), g.id);
  return Boolean(g.lostJob || (sends.length
    ? sends.some(send => isHeldStatus(send.status))
    : g.remoteJob || g.sending != null || g.sends?.some(send => unacknowledged(send) || send.status === 'sent')));
}

export function hasUncertainTicketSend(g: Generation): boolean {
  const sends = sendsForGeneration(ticketForGeneration(g.id), g.id);
  return sends.length
    ? sends.some(s => s.status === 'uncertain')
    : Boolean(g.lostJob || g.sends?.some(s => s.status === 'uncertain'));
}

export function hasUnstoredPaidResult(g: Pick<Generation, 'kind' | 'status' | 'assetIds' | 'text'>, sends: readonly { status: string; index: number }[]): boolean {
  return g.status !== 'done' && sends.some(send => send.status === 'done' &&
    (g.kind === 'text' ? g.text === undefined : send.index >= g.assetIds.length));
}

export function hasOpenInFlightSend(g: Generation): boolean {
  const sends = sendsForGeneration(ticketForGeneration(g.id), g.id);
  return sends.length ? sends.some(unacknowledged) : g.sending != null || Boolean(g.sends?.some(unacknowledged));
}

export function wasFreeTicketSend(g: GenerationSendState & Pick<Generation, 'provider' | 'modelRef' | 'estimate'>, freeAtSend = false): boolean {
  if (generationSends(g).some(send => unacknowledged(send) && (!('price' in send) || !isFreePrice(send.price)))) {
    return false;
  }
  return freeAtSend || g.provider === 'local' || g.modelRef.startsWith('local::') || (g.estimate?.usd === 0 && !g.estimate.lowerBound);
}

export function activeTicketRemoteJob(g: Generation): RemoteJob | undefined {
  return sendsForGeneration(ticketForGeneration(g.id), g.id).find(s => s.status === 'sent' && s.remoteJob)?.remoteJob
    ?? g.remoteJob ?? g.sends?.find(s => s.status === 'sent' && s.remoteJob)?.remoteJob;
}

function findRemoteSend(ticket: ApprovalTicket | undefined, genId: string, job: RemoteJob) {
  return sendsForGeneration(ticket, genId).find(s => s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider);
}

/** Adopt a recovered remote job onto the ticket's open uncertain/in_flight send. Returns true if handled on ticket. */
export function adoptRecoveredJobOnTicket(genId: string, job: RemoteJob): boolean {
  const ticket = ticketForGeneration(genId);
  if (!ticket) return false;
  const open = sendsForGeneration(ticket, genId).find((s) => !s.remoteJob && (s.status === 'uncertain' || s.status === 'in_flight'));
  if (!open) return false;
  storeTickets.put(markSendSent(ticket, open.id, job));
  return true;
}

/** Settlement and local output delivery are separate operations. */
export function isRemoteJobDelivered(g: Generation, job: RemoteJob): boolean {
  const send = generationSends(g).find(s => s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider);
  return send?.status === 'done' && !hasUnstoredPaidResult(g, [send]);
}

/** Settle a followed remote job on the ticket and book spend idempotently by `sendId`. Returns sendId if handled. */
export function settleTicketRemoteSend(
  genId: string,
  job: RemoteJob,
  costUsd: number | null | undefined,
  estimated: boolean,
): string | undefined {
  const ticket = ticketForGeneration(genId);
  const g = get().generations[genId];
  if (!ticket || !g) return undefined;
  const match = findRemoteSend(ticket, genId, job);
  if (!match) return undefined;
  const settled = settleSend(ticket, match.id, { costUsd, estimated });
  storeTickets.put(settled.ticket);
  if (!settled.alreadyBooked && (settled.bookedDeltaUsd > 0 || settled.bookedUnknown)) {
    bookGenerationSpend(g, {
      ticketId: ticket.id,
      sendId: match.id,
      usd: settled.bookedUnknown ? null : settled.bookedDeltaUsd,
      estimated: settled.bookedUnknown ? true : estimated,
    });
  }
  return match.id;
}

/** Mark a failed remote job (`JobFailedError`) as failed on the ticket so reservation releases and it is never resurrected. */
export function failTicketRemoteJob(genId: string, job: RemoteJob, error?: string): boolean {
  const ticket = ticketForGeneration(genId);
  if (!ticket) return false;
  const match = findRemoteSend(ticket, genId, job);
  if (!match || match.status === 'done' || match.status === 'failed') return false;
  storeTickets.put(markSendFailed(ticket, match.id, error));
  return true;
}

/** On reload (`resumeInterrupted`), transition any unacknowledged `in_flight` ticket send to `uncertain` (retaining reservation). */
export function interruptTicketOnReload(
  g: Generation,
  job: RemoteJob | undefined,
): { handled: boolean; maybeCharged: boolean } {
  const ticket = ticketForGeneration(g.id);
  const sends = sendsForGeneration(ticket, g.id);
  if (!ticket || !sends.length) return { handled: false, maybeCharged: false };
  const next = job ? ticket : interruptSends(ticket, send => sends.includes(send) && !send.remoteJob);
  storeTickets.put(next);
  const updated = sendsForGeneration(next, g.id);
  const midLocalStore = !job && !wasFreeTicketSend(g) && (
    (g.sending != null && g.assetIds.length === 0) ||
    hasUnstoredPaidResult(g, updated)
  );
  const maybeCharged = !job && (updated.some((s) => s.status === 'uncertain') || midLocalStore);
  return { handled: true, maybeCharged };
}

export function hasLlmPossibleCharge(runId: string | undefined): boolean {
  const status = runId && storeTickets.get(`llm:${runId}`)?.sends.at(-1)?.status;
  return status === 'in_flight' || status === 'uncertain';
}
