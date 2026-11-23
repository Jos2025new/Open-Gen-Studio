/*
 * Durable approval ticket and send-slot state machine (D+ pilot, docs/diagnostico-dinero.md).
 * Pure types and transitions — one place answers "did this paid send already go out?",
 * tracks in-flight / uncertain reservations, and settles spend idempotently by sendId.
 * Own registry (not Generation.sends[]) so LLM calls, multi-step commands, plans and node
 * runs share the exact same model.
 */
import type { Estimate } from '../types';
import type { RemoteJob } from '../sendTypes';

export type PriceKind = 'exact' | 'estimated' | 'unknown';

export interface MoneyPrice {
  readonly kind: PriceKind;
  /** Published or estimated USD, or `null` when `kind === 'unknown'`. */
  readonly usd: number | null;
  /**
   * Verifiable upper bound checkable against an active budget limit:
   * - `exact` or bounded `estimated` → `usd`
   * - `unknown` or `lowerBound` (minimum-only, no ceiling) → `null`
   */
  readonly maxVerifiableUsd: number | null;
  readonly lowerBound?: boolean;
  readonly note?: string;
}

export type TicketKind = 'generation' | 'node_run' | 'plan' | 'commands' | 'retry' | 'substitute_402' | 'llm';
export type TicketSendStatus = 'pending' | 'in_flight' | 'sent' | 'done' | 'failed' | 'uncertain';

export interface FrozenScope {
  /** Resolved node ids frozen from the approved preview (never re-expanded on execute). */
  readonly nodeIds?: readonly string[];
  /** Full frozen sequence (including `write` steps and `$N` producers) or plan step ids. */
  readonly steps?: readonly unknown[];
  /** Preview signature / input-pins digest for detecting edits between approve and execute. */
  readonly signature?: string;
}

export interface TicketPass {
  readonly kind: 'within_limit' | 'once' | 'session_no_ask';
  /** Cumulative USD ceiling for this pass (`null` only when `allowUnknown` is explicitly true). */
  readonly maxUsd: number | null;
  /** True only when the user explicitly approved an unknown or lowerBound price once. */
  readonly allowUnknown?: boolean;
}

export interface TicketSend {
  readonly id: string;
  readonly slotKey: string;
  readonly index: number;
  readonly status: TicketSendStatus;
  readonly price: MoneyPrice;
  /** USD held against remaining budget while `in_flight`, `sent`, or `uncertain`. */
  readonly reservedUsd: number;
  readonly generationId?: string;
  readonly nodeId?: string;
  readonly remoteJob?: RemoteJob;
  readonly settledUsd?: number | null;
  readonly settledEstimated?: boolean;
  /** Idempotency flag: true once this `sendId` has been booked to Spending. */
  readonly booked?: boolean;
  readonly bookedUsd?: number;
  readonly bookedUnknown?: boolean;
  readonly error?: string;
  readonly updatedAt: number;
}

export interface ApprovalTicket {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: TicketKind;
  readonly createdAt: number;
  readonly scope: FrozenScope;
  readonly price: MoneyPrice;
  readonly pass?: TicketPass;
  readonly sends: readonly TicketSend[];
}

export class SendTransitionError extends Error {
  constructor(
    readonly sendId: string,
    readonly from: TicketSendStatus,
    readonly to: TicketSendStatus,
    message?: string,
  ) {
    super(message ?? `Invalid send transition for ${sendId}: ${from} -> ${to}`);
    this.name = 'SendTransitionError';
  }
}

export function roundUsd(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export const FREE_PRICE: MoneyPrice = Object.freeze({ kind: 'exact', usd: 0, maxVerifiableUsd: 0 });
export const UNKNOWN_PRICE: MoneyPrice = Object.freeze({ kind: 'unknown', usd: null, maxVerifiableUsd: null });

/** Convert an existing engine `Estimate` into the 3-kind `MoneyPrice` with `maxVerifiableUsd`. */
export function priceFromEstimate(e: Estimate): MoneyPrice {
  if (e.usd == null || !Number.isFinite(e.usd)) {
    return { kind: 'unknown', usd: null, maxVerifiableUsd: null, ...(e.note ? { note: e.note } : {}) };
  }
  const usd = roundUsd(Math.max(0, e.usd));
  if (usd === 0 && !e.lowerBound) {
    return { kind: 'exact', usd: 0, maxVerifiableUsd: 0, ...(e.note ? { note: e.note } : {}) };
  }
  if (e.lowerBound) {
    return { kind: 'estimated', usd, maxVerifiableUsd: null, lowerBound: true, ...(e.note ? { note: e.note } : {}) };
  }
  return {
    kind: e.approximate ? 'estimated' : 'exact',
    usd,
    maxVerifiableUsd: e.unbounded ? null : usd,
    ...(e.note ? { note: e.note } : {}),
  };
}

export function exactPrice(usd: number, note?: string): MoneyPrice {
  const clean = roundUsd(Math.max(0, usd));
  return { kind: 'exact', usd: clean, maxVerifiableUsd: clean, ...(note ? { note } : {}) };
}

export function estimatedPrice(usd: number, opts: { lowerBound?: boolean; note?: string } = {}): MoneyPrice {
  const clean = roundUsd(Math.max(0, usd));
  return {
    kind: 'estimated',
    usd: clean,
    maxVerifiableUsd: opts.lowerBound ? null : clean,
    ...(opts.lowerBound ? { lowerBound: true } : {}),
    ...(opts.note ? { note: opts.note } : {}),
  };
}

export function isFreePrice(price: MoneyPrice): boolean {
  return price.kind === 'exact' && price.usd === 0 && !price.lowerBound;
}

/** Combine multiple prices, dropping `maxVerifiableUsd` whenever any part lacks a verifiable ceiling. */
export function sumPrices(parts: readonly MoneyPrice[]): MoneyPrice {
  if (!parts.length) return FREE_PRICE;
  let usd = 0;
  let anyEstimated = false;
  let anyUnbounded = false;
  let allUnknown = true;
  for (const p of parts) {
    if (p.kind === 'unknown' || p.usd == null) {
      anyUnbounded = true;
      continue;
    }
    allUnknown = false;
    usd += p.usd;
    if (p.kind === 'estimated') anyEstimated = true;
    if (p.maxVerifiableUsd == null || p.lowerBound) anyUnbounded = true;
  }
  if (allUnknown) return UNKNOWN_PRICE;
  const total = roundUsd(usd);
  if (!anyEstimated && !anyUnbounded) return { kind: 'exact', usd: total, maxVerifiableUsd: total };
  return {
    kind: 'estimated',
    usd: total,
    maxVerifiableUsd: anyUnbounded ? null : total,
    ...(anyUnbounded ? { lowerBound: true } : {}),
  };
}

/** Amount reserved in flight/sent/uncertain: verifiable cap, or known lower-bound/estimate, else 0. */
export function reservationForPrice(price: MoneyPrice): number {
  if (isFreePrice(price)) return 0;
  const n = price.maxVerifiableUsd ?? price.usd;
  return n != null && Number.isFinite(n) && n > 0 ? roundUsd(n) : 0;
}

export interface CreateTicketInput {
  id: string;
  sessionId: string;
  kind: TicketKind;
  scope?: FrozenScope;
  price: MoneyPrice;
  pass?: TicketPass;
  sends?: readonly TicketSend[];
  createdAt?: number;
}

export function createTicket(input: CreateTicketInput): ApprovalTicket {
  return {
    id: input.id,
    sessionId: input.sessionId,
    kind: input.kind,
    createdAt: input.createdAt ?? Date.now(),
    scope: input.scope ?? {},
    price: input.price,
    ...(input.pass ? { pass: input.pass } : {}),
    sends: input.sends ? [...input.sends] : [],
  };
}

export interface PrepareSendInput {
  id: string;
  slotKey: string;
  index?: number;
  price: MoneyPrice;
  nodeId?: string;
  generationId?: string;
  now?: number;
}

/**
 * Assign a stable `sendId` at preparation time (fits single sends, dynamic batches, and LLM loops).
 * Idempotent if a `pending` send with the same `id` already exists; throws if that `id` already left `pending`.
 */
export function prepareSend(ticket: ApprovalTicket, input: PrepareSendInput): ApprovalTicket {
  const existing = ticket.sends.find((s) => s.id === input.id);
  if (existing) {
    if (existing.status === 'pending') return ticket;
    throw new SendTransitionError(input.id, existing.status, 'pending', `Send ${input.id} already left pending (${existing.status})`);
  }
  const send: TicketSend = {
    id: input.id,
    slotKey: input.slotKey,
    index: input.index ?? ticket.sends.length,
    status: 'pending',
    price: input.price,
    reservedUsd: 0,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.generationId ? { generationId: input.generationId } : {}),
    updatedAt: input.now ?? Date.now(),
  };
  return { ...ticket, sends: [...ticket.sends, send] };
}

function updateSend(
  ticket: ApprovalTicket,
  sendId: string,
  fn: (current: TicketSend) => TicketSend,
): ApprovalTicket {
  const at = ticket.sends.findIndex((s) => s.id === sendId);
  if (at < 0) throw new Error(`Send ${sendId} not found on ticket ${ticket.id}`);
  const next = fn(ticket.sends[at]);
  if (next === ticket.sends[at]) return ticket;
  const sends = ticket.sends.slice();
  sends[at] = next;
  return { ...ticket, sends };
}

/** `pending -> in_flight`: reserves funds immediately before durable save and transport. */
export function markSendInFlight(ticket: ApprovalTicket, sendId: string, now = Date.now()): ApprovalTicket {
  return updateSend(ticket, sendId, (s) => {
    if (s.status !== 'pending') throw new SendTransitionError(sendId, s.status, 'in_flight');
    return { ...s, status: 'in_flight', reservedUsd: reservationForPrice(s.price), error: undefined, updatedAt: now };
  });
}

/**
 * `in_flight -> pending`: releases reservation cleanly when aborted before transport, durable save failed,
 * or provider refused before charging with a retryable error (e.g. Atlas upstream denied, LLM 400 reasoning).
 */
export function rollbackSendToPending(ticket: ApprovalTicket, sendId: string, now = Date.now()): ApprovalTicket {
  return updateSend(ticket, sendId, (s) => {
    if (s.status !== 'in_flight') throw new SendTransitionError(sendId, s.status, 'pending');
    return { ...s, status: 'pending', reservedUsd: 0, updatedAt: now };
  });
}

/** `in_flight | uncertain -> sent`: provider acknowledged and returned a remote job id; reservation stays held. */
export function markSendSent(ticket: ApprovalTicket, sendId: string, remoteJob: RemoteJob, now = Date.now()): ApprovalTicket {
  return updateSend(ticket, sendId, (s) => {
    if (s.status !== 'in_flight' && s.status !== 'uncertain') throw new SendTransitionError(sendId, s.status, 'sent');
    const reservedUsd = s.reservedUsd > 0 ? s.reservedUsd : reservationForPrice(s.price);
    return { ...s, status: 'sent', remoteJob, reservedUsd, error: undefined, updatedAt: now };
  });
}

/** `in_flight -> uncertain`: connection dropped after accept and before ack/jobId; reservation stays held. */
export function markSendUncertain(ticket: ApprovalTicket, sendId: string, error?: string, now = Date.now()): ApprovalTicket {
  return updateSend(ticket, sendId, (s) => {
    if (s.status !== 'in_flight') throw new SendTransitionError(sendId, s.status, 'uncertain');
    const reservedUsd = s.reservedUsd > 0 ? s.reservedUsd : reservationForPrice(s.price);
    return { ...s, status: 'uncertain', reservedUsd, ...(error ? { error } : {}), updatedAt: now };
  });
}

/** `in_flight | sent | uncertain -> failed`: confirmed failure or explicit user resolution; releases reservation. */
export function markSendFailed(ticket: ApprovalTicket, sendId: string, error?: string, now = Date.now()): ApprovalTicket {
  return updateSend(ticket, sendId, (s) => {
    if (s.status !== 'in_flight' && s.status !== 'sent' && s.status !== 'uncertain') {
      throw new SendTransitionError(sendId, s.status, 'failed');
    }
    return { ...s, status: 'failed', reservedUsd: 0, ...(error ? { error } : {}), updatedAt: now };
  });
}

export interface SettleSendInput {
  /** Final provider-reported, quoted, or estimated USD; `null`/`undefined` when price was unknown. */
  costUsd?: number | null;
  estimated?: boolean;
  now?: number;
}

export interface SettleSendResult {
  readonly ticket: ApprovalTicket;
  readonly alreadyBooked: boolean;
  readonly bookedDeltaUsd: number;
  readonly bookedUnknown: boolean;
}

/**
 * `in_flight | sent | uncertain | done -> done`: idempotent settlement by `sendId`.
 * Releases reservation and books spend at most once; subsequent calls return `alreadyBooked: true` with 0 delta.
 */
export function settleSend(ticket: ApprovalTicket, sendId: string, input: SettleSendInput = {}): SettleSendResult {
  const cur = ticket.sends.find((s) => s.id === sendId);
  if (!cur) throw new Error(`Send ${sendId} not found on ticket ${ticket.id}`);
  if (cur.status === 'done' && cur.booked) {
    return { ticket, alreadyBooked: true, bookedDeltaUsd: 0, bookedUnknown: false };
  }
  if (cur.status !== 'in_flight' && cur.status !== 'sent' && cur.status !== 'uncertain' && cur.status !== 'done') {
    throw new SendTransitionError(sendId, cur.status, 'done');
  }
  const hasUsd = input.costUsd != null && Number.isFinite(input.costUsd);
  const bookedDeltaUsd = hasUsd ? Math.round(Math.max(0, input.costUsd!) * 1_000_000) / 1_000_000 : 0;
  const bookedUnknown = !hasUsd && !isFreePrice(cur.price);
  const next = updateSend(ticket, sendId, (s) => ({
    ...s,
    status: 'done',
    reservedUsd: 0,
    settledUsd: hasUsd ? bookedDeltaUsd : null,
    settledEstimated: Boolean(input.estimated || !hasUsd),
    booked: true,
    ...(hasUsd ? { bookedUsd: bookedDeltaUsd } : {}),
    ...(bookedUnknown ? { bookedUnknown: true } : {}),
    error: undefined,
    updatedAt: input.now ?? Date.now(),
  }));
  return { ticket: next, alreadyBooked: false, bookedDeltaUsd, bookedUnknown };
}

/** Attach a `generationId` to an already-prepared send without changing its lifecycle state. */
export function attachGenerationToSend(ticket: ApprovalTicket, sendId: string, generationId: string, now = Date.now()): ApprovalTicket {
  return updateSend(ticket, sendId, (s) => (s.generationId === generationId ? s : { ...s, generationId, updatedAt: now }));
}

export function isHeldStatus(status: TicketSendStatus): boolean {
  return status === 'in_flight' || status === 'sent' || status === 'uncertain';
}

export function isClosedLlmTicket(ticket: ApprovalTicket): boolean {
  return ticket.kind === 'llm' && ticket.sends.every((send) => send.status === 'done' || send.status === 'failed');
}

export function isSendOut(status: TicketSendStatus): boolean {
  return status === 'in_flight' || status === 'sent' || status === 'done' || status === 'uncertain';
}

/** Total USD currently reserved by this ticket (`in_flight` + `sent` + `uncertain`). */
export function ticketReservedUsd(ticket: ApprovalTicket): number {
  let sum = 0;
  for (const s of ticket.sends) {
    if (isHeldStatus(s.status)) sum += s.reservedUsd;
  }
  return roundUsd(sum);
}

/** Total USD already booked on this ticket. */
export function ticketBookedUsd(ticket: ApprovalTicket): number {
  let sum = 0;
  for (const s of ticket.sends) {
    if (s.booked && s.bookedUsd != null) sum += s.bookedUsd;
  }
  return roundUsd(sum);
}

/** Committed USD on a ticket: booked spend + open reservations (used for cumulative pass caps). */
export function ticketCommittedUsd(ticket: ApprovalTicket): number {
  return roundUsd(ticketBookedUsd(ticket) + ticketReservedUsd(ticket));
}

/** Total USD reserved across all tickets in the store. */
export function totalReservedUsd(tickets: readonly ApprovalTicket[]): number {
  let sum = 0;
  for (const t of tickets) sum += ticketReservedUsd(t);
  return roundUsd(sum);
}

/** Remaining budget accounting for both confirmed `spentUsd` and all open reservations. */
export function availableBudgetUsd(budgetUsd: number, spentUsd: number, tickets: readonly ApprovalTicket[]): number {
  return roundUsd(budgetUsd - spentUsd - totalReservedUsd(tickets));
}

export interface SendLookup {
  ticketId?: string;
  sendId?: string;
  slotKey?: string;
  nodeId?: string;
  generationId?: string;
}

export interface SendLookupResult {
  readonly status: TicketSendStatus | 'none';
  readonly alreadyOut: boolean;
  readonly hasUncertain: boolean;
  readonly matches: readonly TicketSend[];
}

const STATUS_PRIORITY: Record<TicketSendStatus, number> = {
  uncertain: 6,
  in_flight: 5,
  sent: 4,
  done: 3,
  pending: 2,
  failed: 1,
};

/** Single authoritative query: "did this paid send / slot / node / generation already go out?" */
export function sendStateOf(tickets: readonly ApprovalTicket[], query: SendLookup): SendLookupResult {
  const matches: TicketSend[] = [];
  for (const t of tickets) {
    if (query.ticketId && t.id !== query.ticketId) continue;
    for (const s of t.sends) {
      if (query.sendId && s.id !== query.sendId) continue;
      if (query.slotKey && s.slotKey !== query.slotKey) continue;
      if (query.nodeId && s.nodeId !== query.nodeId) continue;
      if (query.generationId && s.generationId !== query.generationId) continue;
      matches.push(s);
    }
  }
  if (!matches.length) return { status: 'none', alreadyOut: false, hasUncertain: false, matches };
  let top = matches[0].status;
  let alreadyOut = false;
  let hasUncertain = false;
  for (const s of matches) {
    if (STATUS_PRIORITY[s.status] > STATUS_PRIORITY[top]) top = s.status;
    if (isSendOut(s.status)) alreadyOut = true;
    if (s.status === 'uncertain') hasUncertain = true;
  }
  return { status: top, alreadyOut, hasUncertain, matches };
}
