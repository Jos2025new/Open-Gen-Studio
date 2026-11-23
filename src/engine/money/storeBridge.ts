/*
 * Store adapter for D+ approval tickets and paidSend (docs/diagnostico-dinero.md).
 * `useStore.tickets` is the sole authoritative source for in-flight reservations, slot state and
 * idempotent spend booking. Writes to a generation ticket project a read-only derived view onto
 * `Generation` (`sends`, `sending`, `remoteJob`, `jobId`, `lostJob`) so untouched UI components,
 * legacy recovery paths and existing tests keep working without maintaining a second decision engine.
 */
import { AbortedError, HttpError, isAbort, JobFailedError, NetworkError } from '../../lib/http';
import { uid } from '../../lib/id';
import { guard } from '../../lib/saveGuard';
import { holdsWriterLock } from '../../lib/writerLock';
import { saveStatus } from '../../store/saveStatus';
import { addSpend } from '../../store/spend';
import { patchGeneration, saveNow, upsertTicket, useStore } from '../../store/store';
import { OverLimitError } from '../budget';
import { isRestart } from '../checkStatus';
import { noAskDurable } from '../noAsk';
import { shareOfEstimate } from '../sendLedger';
import type { Estimate, Generation, RemoteJob, SendRecord } from '../types';
import {
  paidSend,
  PaidSendBlockedError,
  type BudgetSnapshot,
  type PaidSendOutcome,
  type PaidSendTransportResult,
  type SendErrorDisposition,
  type SpendBooking,
  type TicketAccess,
} from './paidSend';
import {
  createTicket,
  estimatedPrice,
  exactPrice,
  FREE_PRICE,
  isFreePrice,
  markSendFailed,
  markSendSent,
  markSendUncertain,
  priceFromEstimate,
  roundUsd,
  settleSend,
  ticketBookedUsd,
  UNKNOWN_PRICE,
  type ApprovalTicket,
  type MoneyPrice,
  type TicketKind,
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
function projectTicketToGeneration(ticket: ApprovalTicket): void {
  const genId = generationIdFromTicket(ticket.id);
  if (!genId || !ticket.sends.length) return;
  const cur = get().generations[genId];
  if (!cur) return;

  const visible = ticket.sends.filter((s) => s.status !== 'pending').map(toLegacySend);
  const inFlight = ticket.sends.find((s) => s.status === 'in_flight');
  const activeSent = ticket.sends.find((s) => s.status === 'sent' && s.remoteJob);
  const hasUncertain = cur.status !== 'done' && ticket.sends.some((s) => s.status === 'uncertain');

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
  list: () => {
    const st = get();
    return Object.values(st.tickets).filter((t) => {
      if (!st.sessions[t.sessionId]) return false;
      if (t.id.startsWith('gen:') && !st.generations[t.id.slice(4)]) return false;
      return true;
    });
  },
  put: (ticket) => {
    upsertTicket(ticket);
    projectTicketToGeneration(ticket);
  },
};

function ticketForGeneration(genId: string): ApprovalTicket | undefined {
  return get().tickets[generationTicketId(genId)];
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
  const unknown = estimate.usd == null || Boolean(estimate.lowerBound);
  return {
    kind: 'once',
    maxUsd: unknown ? null : estimate.usd,
    ...(unknown ? { allowUnknown: true } : {}),
  };
}

/** Ensure a generation has an authoritative ticket in `useStore.tickets` without touching legacy `g.sends`. */
export function ensureGenerationTicket(
  g: Generation,
  opts: { pass?: TicketPass; kind?: TicketKind } = {},
): ApprovalTicket {
  const id = generationTicketId(g.id);
  const existing = get().tickets[id];
  if (existing) {
    if (opts.pass !== undefined) {
      const updated: ApprovalTicket = { ...existing, price: priceFromEstimate(g.estimate), pass: opts.pass };
      upsertTicket(updated);
      return updated;
    }
    return existing;
  }
  const created = createTicket({
    id,
    sessionId: g.sessionId,
    kind: opts.kind ?? 'generation',
    price: priceFromEstimate(g.estimate),
    ...(opts.pass ? { pass: opts.pass } : {}),
  });
  upsertTicket(created);
  return created;
}

export function grantGenerationTicketPass(genId: string, estimate: Estimate): void {
  const g = get().generations[genId];
  if (!g) return;
  const existing = ticketForGeneration(genId);
  const booked = existing ? ticketBookedUsd(existing) : 0;
  const unknown = estimate.usd == null || Boolean(estimate.lowerBound);
  const pass: TicketPass = {
    kind: 'once',
    maxUsd: unknown ? null : roundUsd(booked + estimate.usd!),
    ...(unknown ? { allowUnknown: true } : {}),
  };
  ensureGenerationTicket(g, { pass });
}

/** Compute the per-send `MoneyPrice`, respecting local/free models, explicit quotes and proportional batch estimates. */
export function slotPriceForGeneration(
  g: Pick<Generation, 'provider' | 'modelRef' | 'estimate' | 'retryBaseEstimate' | 'retryTotal' | 'variants' | 'assetIds' | 'settings'>,
  items = 1,
  quote?: number | null,
): MoneyPrice {
  if (g.provider === 'local' || g.modelRef.startsWith('local::')) return FREE_PRICE;
  if (quote != null && Number.isFinite(quote) && quote > 0) return exactPrice(quote);
  if (g.estimate?.usd === 0 && !g.estimate.lowerBound && (quote == null || quote === 0)) return FREE_PRICE;
  const share = shareOfEstimate(g as Generation, items);
  if (share == null || !Number.isFinite(share)) return UNKNOWN_PRICE;
  if (g.estimate?.lowerBound) return estimatedPrice(share, { lowerBound: true });
  return g.estimate?.approximate ? estimatedPrice(share) : exactPrice(share);
}

/** Contextual message when pre-send durable persistence fails (preserves partial-batch and prior-uncertain warnings). */
function notSentMessage(g: Generation | undefined, reqId?: string): string {
  const ticket = g ? ticketForGeneration(g.id) : undefined;
  if (ticket && ticket.sends.length > 0) {
    const priorBatch = ticket.sends.some((s) => s.id !== reqId && (s.status === 'done' || s.status === 'sent' || s.status === 'failed'))
      || Boolean(g && g.assetIds.length > 0 && !g.parentId);
    if (priorBatch) return PARTIAL_NOT_SENT_MESSAGE;
    const priorUncertain = ticket.sends.some((s) => s.id !== reqId && (s.status === 'uncertain' || Boolean(s.remoteJob)))
      || Boolean(g?.lostJob || g?.remoteJob);
    return priorUncertain ? PRIOR_UNCERTAIN_NOT_SENT_MESSAGE : NOT_SENT_MESSAGE;
  }
  const priorBatch = Boolean(
    g && (g.sends?.some((s) => s.id !== reqId && (s.status === 'done' || s.status === 'sent' || s.status === 'failed')) || (g.assetIds.length > 0 && !g.parentId)),
  );
  if (priorBatch) return PARTIAL_NOT_SENT_MESSAGE;
  const priorUncertain = Boolean(
    g && (g.lostJob || g.remoteJob || g.sends?.some((s) => s.id !== reqId && (s.status === 'uncertain' || Boolean(s.remoteJob)))),
  );
  return priorUncertain ? PRIOR_UNCERTAIN_NOT_SENT_MESSAGE : NOT_SENT_MESSAGE;
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

function classifyGenerationError(
  err: unknown,
  signal: AbortSignal,
  isRetryable?: (err: unknown) => boolean,
): SendErrorDisposition {
  if (isRestart(signal.reason)) return 'keep_in_flight';
  if (err instanceof JobFailedError) return 'job_failed';
  if (err instanceof NetworkError || isAbort(err) || signal.aborted) return 'uncertain';
  if (isRetryable?.(err)) return 'retryable_before_charge';
  if (err instanceof HttpError && (err.status >= 500 || err.status === 408)) return 'uncertain';
  if (err instanceof HttpError) return 'refused_before_charge';
  if (err && typeof err === 'object') {
    const e = err as { status?: number; message?: string };
    if (e.status === 402 || /insufficient (credits?|balance|funds)|not enough (credits?|balance)|out of credits/i.test(e.message ?? '')) {
      return 'refused_before_charge';
    }
  }
  return 'uncertain';
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
  const ticket = ensureGenerationTicket(g);
  const price = slotPriceForGeneration(g, items, quote);
  const local = g.provider === 'local' || g.modelRef.startsWith('local::');
  if (local || isFreePrice(price)) void saveNow().catch(() => undefined);
  const sendId = uid('req');
  const slotKey = `${g.id}:${index}`;
  const accepted = ticket.sends.some((slot) => slot.index === index &&
    (slot.status === 'in_flight' || slot.status === 'sent' || slot.status === 'uncertain' || slot.status === 'done'));
  if (accepted) throw new PaidSendBlockedError('ALREADY_SENT', 'This request may already have been charged.', { ticketId: ticket.id, sendId });
  try {
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
      local,
      classifyError: (err) => classifyGenerationError(err, signal, isRetryable),
    });
  } catch (err) {
    if (err instanceof PaidSendBlockedError) {
      if (err.code === 'SAVE_FAILED') throw new SendNotCommittedError(notSentMessage(get().generations[g.id] ?? g, sendId));
      if (err.code === 'ABORTED') throw new AbortedError();
      if (err.code === 'OVER_LIMIT' || err.code === 'UNKNOWN_PRICE' || err.code === 'PASS_EXCEEDED') {
        throw new OverLimitError({
          usd: price.usd,
          approximate: price.kind !== 'exact',
          ...(price.lowerBound ? { lowerBound: true } : {}),
        });
      }
    }
    throw err;
  }
}

/** Authoritative check: does this generation have an open in-flight, sent or uncertain send? (Legacy fallback when no ticket sends.) */
export function hasActiveTicketSend(g: Generation): boolean {
  const ticket = ticketForGeneration(g.id);
  if (ticket && ticket.sends.length > 0) {
    return ticket.sends.some((s) => s.status === 'in_flight' || s.status === 'sent' || s.status === 'uncertain');
  }
  return Boolean(
    g.remoteJob ||
    g.lostJob ||
    g.sending != null ||
    g.sends?.some((s) => s.status === 'uncertain' || s.status === 'intent' || Boolean(s.remoteJob)),
  );
}

/** True when this generation has an uncertain send (reads ticket first, legacy fallback if absent). */
export function hasUncertainTicketSend(g: Generation): boolean {
  const ticket = ticketForGeneration(g.id);
  if (ticket && ticket.sends.length > 0) {
    return ticket.sends.some((s) => s.status === 'uncertain');
  }
  return Boolean(g.lostJob || g.sends?.some((s) => s.status === 'uncertain'));
}

/** True when this generation has an unacknowledged in-flight or uncertain send (for reload `allDelivered` check). */
export function hasOpenInFlightSend(g: Generation): boolean {
  const ticket = ticketForGeneration(g.id);
  if (ticket && ticket.sends.length > 0) {
    return ticket.sends.some((s) => s.status === 'in_flight' || s.status === 'uncertain');
  }
  return Boolean(g.sending != null || g.sends?.some((s) => s.status === 'intent' || s.status === 'uncertain'));
}

/** True when this generation was judged free (no non-free open ticket sends). */
export function wasFreeTicketSend(g: Pick<Generation, 'id' | 'provider' | 'modelRef' | 'estimate' | 'sends'>, freeAtSend = false): boolean {
  const ticket = ticketForGeneration(g.id);
  if (ticket && ticket.sends.length > 0) {
    if (ticket.sends.some((s) => !isFreePrice(s.price) && (s.status === 'in_flight' || s.status === 'uncertain'))) return false;
  } else if (g.sends?.some((s) => s.status === 'intent' || s.status === 'uncertain')) {
    return false;
  }
  return freeAtSend || g.provider === 'local' || g.modelRef.startsWith('local::') || (g.estimate?.usd === 0 && !g.estimate.lowerBound);
}

/** Active remote job from ticket first, then legacy Generation fields. */
export function activeTicketRemoteJob(g: Generation): RemoteJob | undefined {
  const ticket = ticketForGeneration(g.id);
  const fromTicket = ticket?.sends.find((s) => s.status === 'sent' && s.remoteJob)?.remoteJob;
  if (fromTicket) return fromTicket;
  return g.remoteJob ?? g.sends?.find((s) => s.status === 'sent' && s.remoteJob)?.remoteJob;
}

/** Adopt a recovered remote job onto the ticket's open uncertain/in_flight send. Returns true if handled on ticket. */
export function adoptRecoveredJobOnTicket(genId: string, job: RemoteJob): boolean {
  const ticket = ticketForGeneration(genId);
  if (!ticket) return false;
  const open = ticket.sends.find((s) => !s.remoteJob && (s.status === 'uncertain' || s.status === 'in_flight'));
  if (!open) return false;
  storeTickets.put(markSendSent(ticket, open.id, job));
  return true;
}

/** True when `job` was already settled (`done`) on the generation's ticket. */
export function isRemoteJobDoneOnTicket(genId: string, job: RemoteJob): boolean {
  const ticket = ticketForGeneration(genId);
  return Boolean(ticket?.sends.some((s) => s.status === 'done' && s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider));
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
  const match = ticket.sends.find((s) => s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider);
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
  const match = ticket.sends.find((s) => s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider);
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
  if (!ticket || !ticket.sends.length) return { handled: false, maybeCharged: false };
  let next = ticket;
  if (!job) {
    for (const s of ticket.sends) {
      if (!s.remoteJob && s.status === 'in_flight') {
        next = markSendUncertain(next, s.id, 'Interrupted by reload');
      }
    }
  }
  if (next !== ticket) storeTickets.put(next);
  const midLocalStore = !job && !wasFreeTicketSend(g) && (
    (g.sending != null && g.assetIds.length === 0) ||
    next.sends.filter((s) => s.status === 'done').length > g.assetIds.length ||
    (g.kind === 'text' && next.sends.some((s) => s.status === 'done') && g.status !== 'done')
  );
  const maybeCharged = !job && (next.sends.some((s) => s.status === 'uncertain') || midLocalStore);
  return { handled: true, maybeCharged };
}
