/*
 * Durable approval ticket and send-slot state machine (D+ pilot, docs/diagnostico-dinero.md).
 * Pure types and transitions: answers "did this paid send go out?", tracks in-flight / uncertain
 * reservations, and settles spend idempotently by sendId. Own registry for media, commands, plans, and LLM.
 */
import type { Estimate, Generation, Session } from '../types';
import type { RemoteJob } from '../sendTypes';

export type PriceKind = 'exact' | 'estimated' | 'unknown';

export interface MoneyPrice {
  readonly kind: PriceKind;
  readonly usd: number | null;
  /** Verifiable ceiling for active spending limits; `null` for `unknown` or `lowerBound`. */
  readonly maxVerifiableUsd: number | null;
  readonly lowerBound?: boolean;
  readonly note?: string;
}

export type TicketKind = 'generation' | 'node_run' | 'plan' | 'commands' | 'llm';
export type TicketSendStatus = 'pending' | 'in_flight' | 'sent' | 'done' | 'failed' | 'uncertain';

export interface FrozenScope {
  readonly nodeIds?: readonly string[];
  readonly steps?: readonly unknown[];
  readonly signature?: string;
  readonly llm?: { provider: string; model: string };
}

export interface TicketPass {
  readonly kind: 'within_limit' | 'once' | 'session_no_ask';
  readonly maxUsd: number | null;
  readonly allowUnknown?: boolean;
}

export interface TicketSend {
  readonly id: string;
  readonly slotKey: string;
  readonly index: number;
  readonly status: TicketSendStatus;
  readonly price: MoneyPrice;
  readonly reservedUsd: number;
  readonly generationId?: string;
  readonly nodeId?: string;
  readonly remoteJob?: RemoteJob;
  readonly settledUsd?: number | null;
  readonly settledEstimated?: boolean;
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
  readonly closed?: boolean;
  readonly scope: FrozenScope;
  readonly price: MoneyPrice;
  readonly pass?: TicketPass;
  readonly sends: readonly TicketSend[];
}

export class SendTransitionError extends Error {
  constructor(readonly sendId: string, readonly from: TicketSendStatus, readonly to: TicketSendStatus, message?: string) {
    super(message ?? `Invalid send transition for ${sendId}: ${from} -> ${to}`);
    this.name = 'SendTransitionError';
  }
}

export const roundUsd = (v: number): number => Math.round(v * 10000) / 10000;
export const FREE_PRICE: MoneyPrice = Object.freeze({ kind: 'exact', usd: 0, maxVerifiableUsd: 0 });
export const UNKNOWN_PRICE: MoneyPrice = Object.freeze({ kind: 'unknown', usd: null, maxVerifiableUsd: null });

/** Convert an existing engine `Estimate` into the 3-kind `MoneyPrice` with `maxVerifiableUsd`. */
export function priceFromEstimate(e: Estimate): MoneyPrice {
  const note = e.note ? { note: e.note } : {};
  if (e.usd == null || !Number.isFinite(e.usd)) return { kind: 'unknown', usd: null, maxVerifiableUsd: null, ...note };
  const usd = roundUsd(Math.max(0, e.usd));
  if (usd === 0 && !e.lowerBound) return { kind: 'exact', usd: 0, maxVerifiableUsd: 0, ...note };
  if (e.lowerBound) return { kind: 'estimated', usd, maxVerifiableUsd: null, lowerBound: true, ...note };
  return { kind: e.approximate ? 'estimated' : 'exact', usd, maxVerifiableUsd: e.unbounded ? null : usd, ...note };
}

export const exactPrice = (usd: number, note?: string): MoneyPrice => {
  const clean = roundUsd(Math.max(0, usd));
  return { kind: 'exact', usd: clean, maxVerifiableUsd: clean, ...(note ? { note } : {}) };
};

export const estimatedPrice = (usd: number, opts: { lowerBound?: boolean; note?: string } = {}): MoneyPrice => {
  const clean = roundUsd(Math.max(0, usd));
  return {
    kind: 'estimated', usd: clean, maxVerifiableUsd: opts.lowerBound ? null : clean,
    ...(opts.lowerBound ? { lowerBound: true } : {}), ...(opts.note ? { note: opts.note } : {}),
  };
};

export const isFreePrice = (price: MoneyPrice): boolean => price.kind === 'exact' && price.usd === 0 && !price.lowerBound;

/** Combine multiple prices, dropping `maxVerifiableUsd` whenever any part lacks a verifiable ceiling. */
export function sumPrices(parts: readonly MoneyPrice[]): MoneyPrice {
  if (!parts.length) return FREE_PRICE;
  let usd = 0, anyEstimated = false, anyUnbounded = false, allUnknown = true;
  for (const p of parts) {
    if (p.kind === 'unknown' || p.usd == null) { anyUnbounded = true; continue; }
    allUnknown = false;
    usd += p.usd;
    if (p.kind === 'estimated') anyEstimated = true;
    if (p.maxVerifiableUsd == null || p.lowerBound) anyUnbounded = true;
  }
  if (allUnknown) return UNKNOWN_PRICE;
  const total = roundUsd(usd);
  return !anyEstimated && !anyUnbounded
    ? { kind: 'exact', usd: total, maxVerifiableUsd: total }
    : { kind: 'estimated', usd: total, maxVerifiableUsd: anyUnbounded ? null : total, ...(anyUnbounded ? { lowerBound: true } : {}) };
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
    id: input.id, sessionId: input.sessionId, kind: input.kind, createdAt: input.createdAt ?? Date.now(),
    scope: input.scope ?? {}, price: input.price, ...(input.pass ? { pass: input.pass } : {}), sends: input.sends ? [...input.sends] : [],
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

/** Assign a stable `sendId` at preparation time; idempotent while `pending`, throws once it left `pending`. */
export function prepareSend(ticket: ApprovalTicket, input: PrepareSendInput): ApprovalTicket {
  const existing = ticket.sends.find((s) => s.id === input.id);
  if (existing) {
    if (existing.status === 'pending') return ticket;
    throw new SendTransitionError(input.id, existing.status, 'pending', `Send ${input.id} already left pending (${existing.status})`);
  }
  const send: TicketSend = {
    id: input.id, slotKey: input.slotKey, index: input.index ?? ticket.sends.length, status: 'pending', price: input.price, reservedUsd: 0,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}), ...(input.generationId ? { generationId: input.generationId } : {}), updatedAt: input.now ?? Date.now(),
  };
  return { ...ticket, sends: [...ticket.sends, send] };
}

function updateSend(ticket: ApprovalTicket, sendId: string, fn: (current: TicketSend) => TicketSend): ApprovalTicket {
  const at = ticket.sends.findIndex((s) => s.id === sendId);
  if (at < 0) throw new Error(`Send ${sendId} not found on ticket ${ticket.id}`);
  const next = fn(ticket.sends[at]);
  if (next === ticket.sends[at]) return ticket;
  const sends = ticket.sends.slice();
  sends[at] = next;
  return { ...ticket, sends };
}

function transitionSend(
  ticket: ApprovalTicket,
  sendId: string,
  from: readonly TicketSendStatus[],
  to: TicketSendStatus,
  patch: (s: TicketSend) => Partial<TicketSend>,
  now = Date.now(),
): ApprovalTicket {
  return updateSend(ticket, sendId, (s) => {
    if (!from.includes(s.status)) throw new SendTransitionError(sendId, s.status, to);
    return { ...s, status: to, ...patch(s), updatedAt: now };
  });
}

export const markSendInFlight = (ticket: ApprovalTicket, sendId: string, now = Date.now()): ApprovalTicket =>
  transitionSend(ticket, sendId, ['pending'], 'in_flight', (s) => ({ reservedUsd: reservationForPrice(s.price), error: undefined }), now);

export const rollbackSendToPending = (ticket: ApprovalTicket, sendId: string, now = Date.now()): ApprovalTicket =>
  transitionSend(ticket, sendId, ['in_flight'], 'pending', () => ({ reservedUsd: 0 }), now);

export const markSendSent = (ticket: ApprovalTicket, sendId: string, remoteJob: RemoteJob, now = Date.now()): ApprovalTicket =>
  transitionSend(ticket, sendId, ['in_flight', 'uncertain'], 'sent', (s) => ({ remoteJob, reservedUsd: s.reservedUsd > 0 ? s.reservedUsd : reservationForPrice(s.price), error: undefined }), now);

export const markSendUncertain = (ticket: ApprovalTicket, sendId: string, error?: string, now = Date.now()): ApprovalTicket =>
  transitionSend(ticket, sendId, ['in_flight'], 'uncertain', (s) => ({ reservedUsd: s.reservedUsd > 0 ? s.reservedUsd : reservationForPrice(s.price), ...(error ? { error } : {}) }), now);

export const markSendFailed = (ticket: ApprovalTicket, sendId: string, error?: string, now = Date.now()): ApprovalTicket =>
  transitionSend(ticket, sendId, ['in_flight', 'sent', 'uncertain'], 'failed', () => ({ reservedUsd: 0, ...(error ? { error } : {}) }), now);

export interface SettleSendInput {
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

/** Idempotent settlement by `sendId`; releases reservation and books spend at most once. */
export function settleSend(ticket: ApprovalTicket, sendId: string, input: SettleSendInput = {}): SettleSendResult {
  const cur = ticket.sends.find((s) => s.id === sendId);
  if (!cur) throw new Error(`Send ${sendId} not found on ticket ${ticket.id}`);
  if (cur.status === 'done' && cur.booked) return { ticket, alreadyBooked: true, bookedDeltaUsd: 0, bookedUnknown: false };
  if (!['in_flight', 'sent', 'uncertain', 'done'].includes(cur.status)) throw new SendTransitionError(sendId, cur.status, 'done');
  const hasUsd = input.costUsd != null && Number.isFinite(input.costUsd);
  const bookedDeltaUsd = hasUsd ? Math.round(Math.max(0, input.costUsd!) * 1_000_000) / 1_000_000 : 0;
  const bookedUnknown = !hasUsd && !isFreePrice(cur.price);
  const next = updateSend(ticket, sendId, (s) => ({
    ...s, status: 'done', reservedUsd: 0, settledUsd: hasUsd ? bookedDeltaUsd : null, settledEstimated: Boolean(input.estimated || !hasUsd),
    booked: true, ...(hasUsd ? { bookedUsd: bookedDeltaUsd } : {}), ...(bookedUnknown ? { bookedUnknown: true } : {}), error: undefined, updatedAt: input.now ?? Date.now(),
  }));
  return { ticket: next, alreadyBooked: false, bookedDeltaUsd, bookedUnknown };
}

export const interruptSends = (ticket: ApprovalTicket, matches: (send: TicketSend) => boolean = () => true): ApprovalTicket =>
  ticket.sends.reduce((next, send) => (send.status === 'in_flight' && matches(send) ? markSendUncertain(next, send.id, 'Interrupted by reload') : next), ticket);

export const isHeldStatus = (status: TicketSendStatus): boolean => status === 'in_flight' || status === 'sent' || status === 'uncertain';
export const isSendOut = (status: TicketSendStatus): boolean => isHeldStatus(status) || status === 'done';
export const ticketsInSessions = (tickets?: Record<string, ApprovalTicket>, sessions?: Record<string, unknown>): ApprovalTicket[] =>
  Object.values(tickets ?? {}).filter((ticket) => !sessions || sessions[ticket.sessionId]);

/** Keep durable tickets only while recovery needs them. Settled media receipts live on the generation. */
export function compactApprovalTickets(
  tickets: Record<string, ApprovalTicket>,
  generations: Record<string, Generation>,
  sessions: Record<string, Session>,
  keepClosed = 0,
): Record<string, ApprovalTicket> {
  const active = new Set(Object.values(generations).filter((g) => g.status === 'queued' || g.status === 'running').map((g) => g.approvalTicketId ?? 'gen:' + g.id));
  const retired: string[] = [];
  for (const ticket of Object.values(tickets)) {
    const legacyId = ticket.id.startsWith('gen:') ? ticket.id.slice(4) : undefined;
    const cardId = ticket.kind === 'commands' ? ticket.id.slice(4) : ticket.kind === 'plan' ? ticket.id.slice(5) : undefined;
    const card = cardId ? sessions[ticket.sessionId]?.feed.find((item) => item.id === cardId) : undefined;
    const cardOpen = (card?.type === 'commands' || card?.type === 'plan') && ['awaiting', 'running', 'review'].includes(card.status);
    if (active.has(ticket.id) || cardOpen || (keepClosed && ticket.kind === 'node_run' && !ticket.closed)) continue;
    const needsTicket = ticket.sends.some((send) => {
      if (isHeldStatus(send.status)) return true;
      if (ticket.kind === 'llm') return false;
      const genId = send.generationId ?? legacyId;
      if (!genId) return !isFreePrice(send.price) && send.status === 'pending';
      const generation = generations[genId];
      return Boolean(generation && send.status === 'done' && !generation.sends?.some((r) => r.id === send.id && r.status === 'done'));
    });
    if (!needsTicket) retired.push(ticket.id);
  }
  if (retired.length <= keepClosed) return tickets;
  const compacted = { ...tickets };
  for (const id of retired.slice(0, retired.length - keepClosed)) delete compacted[id];
  return compacted;
}

export const ticketReservedUsd = (ticket: ApprovalTicket): number =>
  roundUsd(ticket.sends.reduce((sum, s) => sum + (isHeldStatus(s.status) ? s.reservedUsd : 0), 0));

export const ticketCommittedUsd = (ticket: ApprovalTicket): number =>
  roundUsd(ticket.sends.reduce((sum, s) => sum + (s.booked ? s.bookedUsd ?? 0 : 0), ticketReservedUsd(ticket)));

export const totalReservedUsd = (tickets: readonly ApprovalTicket[]): number =>
  roundUsd(tickets.reduce((sum, t) => sum + ticketReservedUsd(t), 0));

export const availableBudgetUsd = (budgetUsd: number, spentUsd: number, tickets: readonly ApprovalTicket[]): number =>
  roundUsd(budgetUsd - spentUsd - totalReservedUsd(tickets));

export interface SendLookup { ticketId?: string; sendId?: string; slotKey?: string; nodeId?: string; generationId?: string }
export interface SendLookupResult { readonly status: TicketSendStatus | 'none'; readonly alreadyOut: boolean; readonly hasUncertain: boolean; readonly matches: readonly TicketSend[] }

const STATUS_PRIORITY: Record<TicketSendStatus, number> = { uncertain: 6, in_flight: 5, sent: 4, done: 3, pending: 2, failed: 1 };

/** Single authoritative query: "did this paid send / slot / node / generation already go out?" */
export function sendStateOf(tickets: readonly ApprovalTicket[], query: SendLookup): SendLookupResult {
  const matches = tickets.flatMap((t) => (query.ticketId && t.id !== query.ticketId ? [] : t.sends.filter((s) =>
    (!query.sendId || s.id === query.sendId) && (!query.slotKey || s.slotKey === query.slotKey) &&
    (!query.nodeId || s.nodeId === query.nodeId) && (!query.generationId || s.generationId === query.generationId))));
  if (!matches.length) return { status: 'none', alreadyOut: false, hasUncertain: false, matches };
  const top = matches.reduce((best, s) => (STATUS_PRIORITY[s.status] > STATUS_PRIORITY[best] ? s.status : best), matches[0].status);
  return { status: top, alreadyOut: matches.some((s) => isSendOut(s.status)), hasUncertain: matches.some((s) => s.status === 'uncertain'), matches };
}
