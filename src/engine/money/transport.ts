import { HttpError } from '../../lib/http';
import { uid } from '../../lib/id';
import { addSpend } from '../../store/spend';
import { llmCallEstimate } from '../budget';
import { chat, type ChatResult, type ReasoningEffort, type ToolSpec } from '../providers/llm';
import type { LlmMessage, LlmProviderId, ProviderId, RemoteJob } from '../types';
import { atlas } from '../providers/atlas';
import { local } from '../providers/demo';
import { fal } from '../providers/fal';
import { nanogpt } from '../providers/nanogpt';
import { openrouter } from '../providers/openrouter';
import type { GenResult, ProviderAdapter } from '../providers/types';
import { paidSend, PaidSendBlockedError } from './paidSend';
import {
  budgetSnapshotFor,
  canWriteTicket,
  saveTicketMark,
  sendGenerationViaPaidGate,
  type GenerationPaidSendOpts,
  grantTicketPass,
  legacyPaidSendError,
  storeTickets,
} from './storeBridge';
import {
  createTicket,
  isFreePrice,
  priceFromEstimate,
  type ApprovalTicket,
  type MoneyPrice,
} from './ticket';

type PaidMethod = 'generate' | 'transcribe' | 'createStyle' | 'createVoice';
type RequestOf<K extends PaidMethod> = Parameters<NonNullable<ProviderAdapter[K]>>[0];
export type MediaRequest = { [K in PaidMethod]: { method: K; input: RequestOf<K> } }[PaidMethod];

const permit = Symbol('paid transport');

type GuardedAdapter = Omit<ProviderAdapter, PaidMethod> & {
  generate(request: RequestOf<'generate'>, authority: typeof permit): Promise<GenResult>;
  transcribe?(request: RequestOf<'transcribe'>, authority: typeof permit): Promise<GenResult>;
  createStyle?(request: RequestOf<'createStyle'>, authority: typeof permit): Promise<GenResult>;
  createVoice?(request: RequestOf<'createVoice'>, authority: typeof permit): Promise<GenResult>;
};

function guardedAdapter(raw: ProviderAdapter): GuardedAdapter {
  const guard = <T>(method: ((request: T) => Promise<GenResult>)) => async (request: T, authority?: typeof permit) => {
    if (authority !== permit) throw new Error('Provider requests require paidSend authorization.');
    return method.call(raw, request);
  };
  const { id, label, shortLabel, listModels, loadSchema, listTranscribers, resume, recover, quote, serialKey, retry, balance } = raw;
  return {
    id, label, shortLabel, listModels, loadSchema, listTranscribers, resume, recover, quote, serialKey, retry, balance,
    generate: guard((req: RequestOf<'generate'>) => raw.generate(req)),
    transcribe: raw.transcribe ? guard((req: RequestOf<'transcribe'>) => raw.transcribe!(req)) : undefined,
    createStyle: raw.createStyle ? guard((req: RequestOf<'createStyle'>) => raw.createStyle!(req)) : undefined,
    createVoice: raw.createVoice ? guard((req: RequestOf<'createVoice'>) => raw.createVoice!(req)) : undefined,
  };
}

export const ADAPTERS: Record<ProviderId, GuardedAdapter> = {
  local: guardedAdapter(local),
  openrouter: guardedAdapter(openrouter),
  fal: guardedAdapter(fal),
  nanogpt: guardedAdapter(nanogpt),
  atlas: guardedAdapter(atlas),
};

type MediaSend = Omit<GenerationPaidSendOpts<GenResult>, 'send'> & {
  provider: ProviderId;
  request: (onRemoteJob: (job: RemoteJob) => void) => MediaRequest;
  settlement: (result: GenResult) => { costUsd: number | null; estimated: boolean };
};

/** Raw media methods are reached only from the gate's transport callback. */
export function sendMediaViaPaidGate({ provider, request, settlement, ...options }: MediaSend) {
  return sendGenerationViaPaidGate({
    ...options,
    send: async ({ onRemoteJob }) => {
      const adapter = ADAPTERS[provider];
      const req = request(onRemoteJob);
      const value = await (req.method === 'generate'
        ? adapter.generate(req.input, permit)
        : req.method === 'transcribe'
          ? adapter.transcribe?.(req.input, permit)
          : req.method === 'createStyle'
            ? adapter.createStyle?.(req.input, permit)
            : adapter.createVoice?.(req.input, permit));
      if (!value) throw new Error(`${adapter.label} cannot run ${req.method}.`);
      return { value, ...settlement(value) };
    },
  });
}

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
  readonly costUsd: number | null;
}

function ensureLlmTicket(opts: {
  ticketId: string;
  sessionId: string;
  provider: LlmProviderId;
  model: string;
  budgetPass?: boolean;
}, price: MoneyPrice, estimate: ReturnType<typeof llmCallEstimate>): ApprovalTicket {
  const existing = storeTickets.get(opts.ticketId);
  let ticket = existing ?? createTicket({
    id: opts.ticketId,
    sessionId: opts.sessionId,
    kind: 'llm',
    scope: { llm: { provider: opts.provider, model: opts.model } },
    price,
  });
  if (opts.budgetPass) {
    return grantTicketPass({ ...ticket, price }, estimate);
  } else if (!existing || ticket.pass) {
    ticket = { ...ticket, pass: undefined };
    storeTickets.put(ticket);
  }
  return ticket;
}

/**
 * Execute one LLM chat call through `paidSend`: reserves estimated spend synchronously before transport,
 * persists the durable mark, streams `chat()`, and settles actual usage cost idempotently by `sendId`.
 */
export async function sendLlmViaPaidGate(opts: LlmPaidSendOpts): Promise<LlmPaidSendOutcome> {
  const estimate = llmCallEstimate(opts.provider, opts.model);
  const price = priceFromEstimate(estimate);
  const sendId = uid('llm');
  const chatOptions = {
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
  };
  if (isFreePrice(price)) {
    const value = await chat(chatOptions);
    const costUsd = value.usage?.costUsd ?? 0;
    if (costUsd > 0) addSpend(costUsd, {
      category: 'agent', provider: opts.provider, model: opts.model,
      sessionId: opts.sessionId, estimated: false, sendId,
    });
    return { sendId, value, costUsd };
  }
  const prior = storeTickets.get(opts.ticketId);
  if (prior?.sends.some((send) => send.status === 'uncertain' || send.status === 'in_flight')) {
    throw new PaidSendBlockedError('ALREADY_SENT', 'This model request may already have been charged.', { ticketId: opts.ticketId });
  }
  const ticket = ensureLlmTicket(opts, price, estimate);
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
        const value = await chat(chatOptions);
        const estimated = value.usage?.costUsd == null;
        const costUsd = value.usage && (!estimated || price.kind !== 'unknown') ? opts.computeUsd(value.usage) : null;
        return { value, costUsd, estimated };
      },
      signal: opts.signal,
      isRetryable: err => err instanceof HttpError && err.status === 400 && /reason|effort|think/i.test(err.message),
    });
    return { sendId: outcome.sendId, value: outcome.value, costUsd: outcome.settled?.ticket.sends.find((send) => send.id === sendId)?.settledUsd ?? null };
  } catch (err) {
    throw legacyPaidSendError(err, price);
  }
}
