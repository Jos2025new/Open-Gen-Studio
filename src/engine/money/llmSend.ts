/*
 * Billable LLM transport routed through the single D+ `paidSend` gate.
 * Every call to `chat()` passes through here: synchronous budget reservation before transport,
 * durable pre-send mark (8 s cap), and idempotent spend settlement by `sendId` from reported usage.
 */
import { AbortedError, HttpError, isAbort, NetworkError } from '../../lib/http';
import { uid } from '../../lib/id';
import { addSpend } from '../../store/spend';
import { llmCallEstimate, OverLimitError } from '../budget';
import { isCreditError } from '../credit';
import { chat, type ChatResult, type ReasoningEffort, type ToolSpec } from '../providers/llm';
import type { LlmMessage, LlmProviderId } from '../types';
import { paidSend, PaidSendBlockedError, type SendErrorDisposition } from './paidSend';
import {
  budgetSnapshotFor,
  canWriteTicket,
  saveTicketMark,
  SendNotCommittedError,
  storeTickets,
} from './storeBridge';
import {
  createTicket,
  priceFromEstimate,
  roundUsd,
  settleSend,
  ticketCommittedUsd,
  type ApprovalTicket,
  type TicketPass,
} from './ticket';

export interface LlmPaidSendOpts {
  readonly ticketId: string;
  readonly sessionId: string;
  readonly provider: LlmProviderId;
  readonly apiKey: string;
  readonly model: string;
  readonly system: string;
  readonly messages: LlmMessage[];
  readonly tools: ToolSpec[];
  readonly effort?: ReasoningEffort;
  readonly showReasoning?: boolean;
  readonly signal: AbortSignal;
  /** True when the user explicitly approved this turn past/without a verifiable limit ("Continue once"). */
  readonly budgetPass?: boolean;
  /** Compute actual USD from provider usage (provider cost or tokens * catalog price). */
  readonly computeUsd: (usage: ChatResult['usage']) => number;
  readonly onText?: (delta: string, full: string) => void;
  readonly onReasoning?: (delta: string, full: string) => void;
  readonly onToolCall?: () => void;
  readonly onNotice?: (text: string) => void;
}

export interface LlmPaidSendOutcome {
  readonly sendId: string;
  readonly value: ChatResult;
  readonly costUsd: number;
}

export function hasLlmPossibleCharge(runId: string | undefined): boolean {
  const status = runId && storeTickets.get(`llm:${runId}`)?.sends.at(-1)?.status;
  return status === 'in_flight' || status === 'uncertain';
}

/** Close the original reservation only after an explicit decision to record its charge as unknown. */
export function reconcileLlmCharge(sessionId: string, ticketId: string): boolean {
  let ticket = storeTickets.get(ticketId);
  if (ticket?.kind !== 'llm' || ticket.sessionId !== sessionId) return false;
  const source = ticket.scope.llm;
  const uncertain = ticket.sends.filter((send) => send.status === 'uncertain');
  for (const send of uncertain) {
    const settlement = settleSend(ticket, send.id, { costUsd: null, estimated: true });
    ticket = settlement.ticket;
    if (settlement.bookedUnknown) {
      addSpend(null, {
        category: 'agent', provider: source?.provider ?? 'Unknown provider', model: source?.model ?? 'Unknown model',
        sessionId, estimated: true, sendId: send.id,
      });
    }
  }
  if (!uncertain.length) return false;
  storeTickets.put(ticket);
  void saveTicketMark().catch(() => undefined);
  return true;
}

function classifyLlmError(err: unknown, signal: AbortSignal): SendErrorDisposition {
  if (err instanceof NetworkError || isAbort(err) || signal.aborted) return 'uncertain';
  if (err instanceof HttpError && (err.status >= 500 || err.status === 408)) return 'uncertain';
  if (isCreditError(err)) return 'refused_before_charge';
  if (err instanceof HttpError) {
    if (err.status === 400 && /reason|effort|think/i.test(err.message)) return 'retryable_before_charge';
    if (err.status >= 400 && err.status < 500 && err.status !== 408) return 'refused_before_charge';
  }
  return 'uncertain';
}

function ensureLlmTicket(opts: {
  ticketId: string;
  sessionId: string;
  provider: LlmProviderId;
  model: string;
  budgetPass?: boolean;
}): { ticket: ApprovalTicket; price: ReturnType<typeof priceFromEstimate> } {
  const est = llmCallEstimate(opts.provider, opts.model);
  const price = priceFromEstimate(est);
  let ticket = storeTickets.get(opts.ticketId);
  if (!ticket) {
    ticket = createTicket({
      id: opts.ticketId,
      sessionId: opts.sessionId,
      kind: 'llm',
      scope: { llm: { provider: opts.provider, model: opts.model } },
      price,
    });
  }
  if (opts.budgetPass) {
    const committed = ticketCommittedUsd(ticket);
    const pass: TicketPass = price.maxVerifiableUsd == null
      ? { kind: 'once', maxUsd: null, allowUnknown: true }
      : { kind: 'once', maxUsd: roundUsd(committed + price.maxVerifiableUsd) };
    ticket = { ...ticket, price, pass };
    storeTickets.put(ticket);
  } else if (!storeTickets.get(opts.ticketId)) {
    storeTickets.put(ticket);
  }
  return { ticket, price };
}

/**
 * Execute one LLM chat call through `paidSend`: reserves estimated spend synchronously before transport,
 * persists the durable mark, streams `chat()`, and settles actual usage cost idempotently by `sendId`.
 */
export async function sendLlmViaPaidGate(opts: LlmPaidSendOpts): Promise<LlmPaidSendOutcome> {
  const { ticket, price } = ensureLlmTicket(opts);
  const sendId = uid('llm');
  let reportedUsd = 0;
  try {
    const outcome = await paidSend<ChatResult>({
      ticketId: ticket.id,
      prepare: {
        id: sendId,
        slotKey: `${ticket.id}:${sendId}`,
        price,
      },
      tickets: storeTickets,
      getBudget: () => budgetSnapshotFor(opts.sessionId),
      save: saveTicketMark,
      canWrite: canWriteTicket,
      onBookSpend: (booking) => {
        addSpend(booking.usd, {
          category: 'agent',
          provider: opts.provider,
          model: opts.model,
          sessionId: opts.sessionId,
          estimated: booking.estimated,
          sendId: booking.sendId,
        });
      },
      send: async () => {
        const value = await chat({
          provider: opts.provider,
          apiKey: opts.apiKey,
          model: opts.model,
          system: opts.system,
          messages: opts.messages,
          tools: opts.tools,
          effort: opts.effort,
          showReasoning: opts.showReasoning,
          signal: opts.signal,
          onText: opts.onText,
          onReasoning: opts.onReasoning,
          onToolCall: opts.onToolCall,
          onNotice: opts.onNotice,
        });
        const estimated = value.usage?.costUsd == null;
        const costUsd = value.usage && (!estimated || price.kind !== 'unknown') ? opts.computeUsd(value.usage) : null;
        reportedUsd = costUsd ?? 0;
        return { value, costUsd, estimated };
      },
      signal: opts.signal,
      classifyError: (err) => classifyLlmError(err, opts.signal),
    });
    return { sendId: outcome.sendId, value: outcome.value, costUsd: reportedUsd };
  } catch (err) {
    if (err instanceof PaidSendBlockedError) {
      if (err.code === 'ABORTED') throw new AbortedError();
      if (err.code === 'SAVE_FAILED') throw new SendNotCommittedError();
      if (err.code === 'OVER_LIMIT' || err.code === 'UNKNOWN_PRICE' || err.code === 'PASS_EXCEEDED') {
        throw new OverLimitError({
          usd: price.usd,
          approximate: price.kind !== 'exact',
          ...(price.usd != null && price.maxVerifiableUsd == null ? { unbounded: true } : {}),
        });
      }
    }
    throw err;
  }
}
