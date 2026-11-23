/*
 * Single paid-send gate (D+ pilot, docs/diagnostico-dinero.md).
 * Enforces in one place: free/local fast path, single lock, slot idempotency, budget check with
 * in-flight & uncertain reservations, cumulative pass cap, durable pre-send mark (8 s cap),
 * and idempotent settlement by sendId. No store coupling and no pluggable store interface (KISS).
 */
import { HttpError, isAbort, NetworkError } from '../../lib/http';
import type { RemoteJob } from '../sendTypes';
import {
  availableBudgetUsd,
  isFreePrice,
  markSendFailed,
  markSendInFlight,
  markSendSent,
  markSendUncertain,
  prepareSend,
  rollbackSendToPending,
  settleSend,
  ticketCommittedUsd,
  type ApprovalTicket,
  type MoneyPrice,
  type PrepareSendInput,
  type SettleSendInput,
  type SettleSendResult,
  type TicketSend,
} from './ticket';

export const PAID_SEND_SAVE_TIMEOUT_MS = 8000;

export type PaidSendBlockCode =
  | 'TICKET_NOT_FOUND' | 'SEND_NOT_FOUND' | 'ALREADY_SENT' | 'LOCKED'
  | 'OVER_LIMIT' | 'UNKNOWN_PRICE' | 'PASS_EXCEEDED' | 'SAVE_FAILED' | 'ABORTED';

export class PaidSendBlockedError extends Error {
  constructor(
    readonly code: PaidSendBlockCode,
    message: string,
    readonly details?: { ticketId?: string; sendId?: string; remainingUsd?: number; requiredUsd?: number | null },
  ) {
    super(message);
    this.name = 'PaidSendBlockedError';
  }
}

const activeLocks = new Set<string>();
export const heldSendLocks = (): readonly string[] => [...activeLocks];
export const resetSendLocks = (): void => { activeLocks.clear(); };

function acquireLocks(keys: readonly string[]): () => void {
  const unique = [...new Set(keys)];
  for (const k of unique) {
    if (activeLocks.has(k)) throw new PaidSendBlockedError('LOCKED', `Paid send lock already held for "${k}".`);
  }
  for (const k of unique) activeLocks.add(k);
  let released = false;
  return () => { if (!released) { released = true; for (const k of unique) activeLocks.delete(k); } };
}

export interface BudgetSnapshot { readonly budgetOn: boolean; readonly budgetUsd: number; readonly spentUsd: number; readonly sessionNoAsk?: boolean }
export interface BudgetGateVerdict { readonly ok: boolean; readonly free: boolean; readonly code?: 'OVER_LIMIT' | 'UNKNOWN_PRICE' | 'PASS_EXCEEDED'; readonly reason?: string; readonly remainingUsd?: number }

/** Pure spending check combining confirmed spend, open reservations, `maxVerifiableUsd`, and cumulative pass cap. */
export function evaluateBudgetGate(opts: {
  ticket?: ApprovalTicket;
  price: MoneyPrice;
  budget: BudgetSnapshot;
  allTickets: readonly ApprovalTicket[];
  local?: boolean;
}): BudgetGateVerdict {
  const { ticket, price, budget, allTickets, local } = opts;
  if (local || isFreePrice(price)) return { ok: true, free: true };
  if (!budget.budgetOn) return { ok: true, free: false };
  const pass = ticket?.pass;
  if (budget.sessionNoAsk || pass?.kind === 'session_no_ask') return { ok: true, free: false };

  const verifiable = price.maxVerifiableUsd;
  const remainingUsd = availableBudgetUsd(budget.budgetUsd, budget.spentUsd, allTickets);
  if (verifiable == null) {
    if (pass?.kind === 'once' && pass.allowUnknown) return { ok: true, free: false, remainingUsd };
    const reason = price.lowerBound
      ? 'Price is only a lower bound without a verifiable ceiling; user confirmation is required.'
      : 'Price is unknown and cannot be checked against the active spending limit.';
    return { ok: false, free: false, code: 'UNKNOWN_PRICE', reason, remainingUsd };
  }
  if (ticket && pass?.kind === 'once') {
    if (pass.allowUnknown) return { ok: true, free: false, remainingUsd };
    const committed = ticketCommittedUsd(ticket);
    if (pass.maxUsd == null || committed + verifiable > pass.maxUsd + 1e-9) {
      return { ok: false, free: false, code: 'PASS_EXCEEDED', reason: `Send ($${verifiable.toFixed(4)}) exceeds the approved pass cap ($${pass.maxUsd ?? 0}).`, remainingUsd };
    }
    return { ok: true, free: false, remainingUsd };
  }
  if (verifiable > remainingUsd + 1e-9) {
    return { ok: false, free: false, code: 'OVER_LIMIT', reason: `Send ($${verifiable.toFixed(4)}) exceeds remaining budget ($${Math.max(0, remainingUsd).toFixed(4)} after reservations).`, remainingUsd };
  }
  return { ok: true, free: false, remainingUsd };
}

export type SendErrorDisposition = 'retryable_before_charge' | 'refused_before_charge' | 'job_failed' | 'keep_in_flight' | 'uncertain';

/** A failure because the account has no credit (HTTP 402, or the provider's own words). */
export function isCreditError(err: unknown): boolean {
  if (err instanceof HttpError && err.status === 402) return true;
  return /insufficient (credits?|balance|funds)|not enough (credits?|balance)|out of credits/i.test(String((err as Error)?.message ?? err));
}

export function classifySendError(err: unknown, opts: Pick<PaidSendOptions<unknown>, 'restart' | 'signal' | 'isRetryable'> = {}): SendErrorDisposition {
  const { name, status, message = '' } = (err ?? {}) as { name?: string; status?: number; message?: string };
  if (opts.restart?.()) return 'keep_in_flight';
  if (name === 'JobFailedError') return 'job_failed';
  if (err instanceof NetworkError || isAbort(err) || opts.signal?.aborted) return 'uncertain';
  const retryable = opts.isRetryable?.(err) ?? ((status === 400 && /reason|effort|think/i.test(message)) || /upstream access denied/i.test(message));
  if (retryable) return 'retryable_before_charge';
  if (status && (status >= 500 || status === 408)) return 'uncertain';
  if (status === 402 || isCreditError(err) || (status && status >= 400 && status < 500)) return 'refused_before_charge';
  return 'uncertain';
}

export interface TicketAccess { get(ticketId: string): ApprovalTicket | undefined; list(): readonly ApprovalTicket[]; put(ticket: ApprovalTicket): void }
export interface SpendBooking { readonly ticketId: string; readonly sendId: string; readonly usd: number | null; readonly estimated: boolean }
export interface PaidSendTransportResult<T> { readonly value: T; readonly costUsd?: number | null; readonly estimated?: boolean }
export interface PaidSendOutcome<T> { readonly sendId: string; readonly value: T; readonly free: boolean; readonly settled?: SettleSendResult }

export interface PaidSendOptions<T> {
  readonly ticketId: string;
  readonly sendId?: string;
  readonly prepare?: PrepareSendInput;
  readonly tickets: TicketAccess;
  readonly getBudget: () => BudgetSnapshot;
  readonly save: () => Promise<void>;
  readonly canWrite?: () => boolean;
  readonly onBookSpend: (booking: SpendBooking) => void;
  readonly beforeTransport?: () => void;
  readonly send: (ctx: { sendId: string; onRemoteJob: (job: RemoteJob) => void }) => Promise<PaidSendTransportResult<T>>;
  readonly signal?: AbortSignal;
  readonly lockKeys?: readonly string[];
  readonly local?: boolean;
  readonly saveTimeoutMs?: number;
  readonly classifyError?: (err: unknown) => SendErrorDisposition;
  readonly restart?: () => boolean;
  readonly isRetryable?: (err: unknown) => boolean;
  readonly now?: () => number;
}

async function saveWithCap(save: () => Promise<void>, timeoutMs: number, ticketId: string, sendId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      save(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PaidSendBlockedError('SAVE_FAILED', `Could not persist paid-send intent within ${timeoutMs} ms.`, { ticketId, sendId })), timeoutMs);
      }),
    ]);
  } catch (err) {
    if (err instanceof PaidSendBlockedError) throw err;
    throw new PaidSendBlockedError('SAVE_FAILED', `Could not persist paid-send intent: ${err instanceof Error ? err.message : String(err)}`, { ticketId, sendId });
  } finally {
    clearTimeout(timer);
  }
}

function findSend(ticket: ApprovalTicket, sendId: string): TicketSend {
  const s = ticket.sends.find((x) => x.id === sendId);
  if (!s) throw new PaidSendBlockedError('SEND_NOT_FOUND', `Send ${sendId} not found on ticket ${ticket.id}.`, { ticketId: ticket.id, sendId });
  return s;
}

/** Run a free request without reserving funds; book any unexpected provider charge. */
export async function sendFree<T>(
  sendId: string,
  send: PaidSendOptions<T>['send'],
  signal?: AbortSignal,
  beforeTransport?: () => void,
  book?: (result: PaidSendTransportResult<T>, costUsd: number) => SettleSendResult | void,
): Promise<PaidSendOutcome<T>> {
  if (signal?.aborted) throw new PaidSendBlockedError('ABORTED', 'Send aborted before start.', { sendId });
  beforeTransport?.();
  const result = await send({ sendId, onRemoteJob: () => undefined });
  const cost = result.costUsd;
  const settled = cost != null && Number.isFinite(cost) && cost > 0 ? book?.(result, cost) : undefined;
  return { sendId, value: result.value, free: true, ...(settled ? { settled } : {}) };
}

/** Single client-side gate for every paid send (media, special ops, 402 substitutes, and LLM). */
export async function paidSend<T>(opts: PaidSendOptions<T>): Promise<PaidSendOutcome<T>> {
  const now = opts.now ?? Date.now;
  let ticket = opts.tickets.get(opts.ticketId);
  if (!ticket) throw new PaidSendBlockedError('TICKET_NOT_FOUND', `Approval ticket ${opts.ticketId} not found.`, { ticketId: opts.ticketId });
  const sendId = opts.prepare?.id ?? opts.sendId;
  if (!sendId) throw new PaidSendBlockedError('SEND_NOT_FOUND', 'paidSend requires either sendId or prepare.id.', { ticketId: opts.ticketId });

  if (opts.prepare) {
    const existing = ticket.sends.find((s) => s.id === sendId);
    if (existing && existing.status !== 'pending') {
      throw new PaidSendBlockedError('ALREADY_SENT', `Send ${sendId} already left pending (${existing.status}).`, { ticketId: ticket.id, sendId });
    }
    if (!existing) {
      ticket = prepareSend(ticket, opts.prepare);
      opts.tickets.put(ticket);
    }
  }

  const slot = findSend(ticket, sendId);
  const close = (latest: ApprovalTicket, input: SettleSendInput) => {
    const settled = settleSend(latest, sendId, { ...input, now: now() });
    opts.tickets.put(settled.ticket);
    if (settled.bookedDeltaUsd > 0 || settled.bookedUnknown) {
      opts.onBookSpend({ ticketId: latest.id, sendId, usd: settled.bookedUnknown ? null : settled.bookedDeltaUsd, estimated: settled.bookedUnknown || Boolean(input.estimated) });
    }
    void opts.save().catch(() => undefined);
    return settled;
  };

  if (opts.local || isFreePrice(slot.price)) {
    const freeTicket = ticket;
    return sendFree(sendId, opts.send, opts.signal, opts.beforeTransport, (result, costUsd) => {
      const latest = opts.tickets.get(opts.ticketId) ?? freeTicket;
      return close(markSendInFlight(latest, sendId, now()), { costUsd, estimated: result.estimated });
    });
  }

  const release = acquireLocks([`send:${sendId}`, ...(opts.lockKeys ?? [])]);
  try {
    ticket = opts.tickets.get(opts.ticketId)!;
    const current = findSend(ticket, sendId);
    if (current.status !== 'pending') throw new PaidSendBlockedError('ALREADY_SENT', `Send ${sendId} is already ${current.status} and cannot be sent again.`, { ticketId: ticket.id, sendId });
    if (opts.signal?.aborted) throw new PaidSendBlockedError('ABORTED', 'Send aborted before reservation.', { ticketId: ticket.id, sendId });
    if (opts.canWrite && !opts.canWrite()) throw new PaidSendBlockedError('SAVE_FAILED', 'Not sent: writer lock is not held or state is discarding.', { ticketId: ticket.id, sendId });

    const verdict = evaluateBudgetGate({ ticket, price: current.price, budget: opts.getBudget(), allTickets: opts.tickets.list(), local: opts.local });
    if (!verdict.ok) {
      throw new PaidSendBlockedError(verdict.code!, verdict.reason ?? 'Blocked by spending limit.', {
        ticketId: ticket.id, sendId, remainingUsd: verdict.remainingUsd, requiredUsd: current.price.maxVerifiableUsd,
      });
    }

    // Reserve synchronously before awaiting save(), closing concurrent races near the limit.
    ticket = markSendInFlight(ticket, sendId, now());
    opts.tickets.put(ticket);
    try {
      await saveWithCap(opts.save, opts.saveTimeoutMs ?? PAID_SEND_SAVE_TIMEOUT_MS, ticket.id, sendId);
      if (opts.canWrite && !opts.canWrite()) throw new PaidSendBlockedError('SAVE_FAILED', 'Not sent: lost writer lock while saving intent.', { ticketId: ticket.id, sendId });
      if (opts.signal?.aborted) throw new PaidSendBlockedError('ABORTED', 'Send aborted before transport.', { ticketId: ticket.id, sendId });
      opts.beforeTransport?.();
    } catch (preErr) {
      const latest = opts.tickets.get(opts.ticketId);
      if (latest?.sends.find((s) => s.id === sendId)?.status === 'in_flight') opts.tickets.put(rollbackSendToPending(latest, sendId, now()));
      throw preErr;
    }

    try {
      const result = await opts.send({
        sendId,
        onRemoteJob: (job) => {
          const latest = opts.tickets.get(opts.ticketId);
          if (!latest) return;
          opts.tickets.put(markSendSent(latest, sendId, job, now()));
          void opts.save().catch(() => undefined);
        },
      });
      const latest = opts.tickets.get(opts.ticketId) ?? ticket;
      const costUsd = result.costUsd !== undefined ? result.costUsd : current.price.usd;
      const estimated = result.estimated ?? (result.costUsd == null || current.price.kind !== 'exact');
      const settled = close(latest, { costUsd, estimated });
      return { sendId, value: result.value, free: false, settled };
    } catch (err) {
      const latest = opts.tickets.get(opts.ticketId);
      const send = latest?.sends.find((x) => x.id === sendId);
      if (latest && send && (send.status === 'in_flight' || send.status === 'sent' || send.status === 'uncertain')) {
        const disposition = opts.classifyError?.(err) ?? classifySendError(err, opts);
        const msg = err instanceof Error ? err.message : String(err);
        if (disposition === 'job_failed') opts.tickets.put(markSendFailed(latest, sendId, msg, now()));
        else if (!send.remoteJob && disposition !== 'keep_in_flight') {
          opts.tickets.put(disposition === 'retryable_before_charge'
            ? rollbackSendToPending(latest, sendId, now())
            : disposition === 'refused_before_charge' ? markSendFailed(latest, sendId, msg, now()) : markSendUncertain(latest, sendId, msg, now()));
        }
        if (disposition !== 'keep_in_flight' && (send.remoteJob || disposition !== 'retryable_before_charge')) void opts.save().catch(() => undefined);
      }
      throw err;
    }
  } finally {
    release();
  }
}
