import { HttpError } from '../../lib/http';
import { uid } from '../../lib/id';
import { addSpend } from '../../store/spend';
import { useStore } from '../../store/store';
import { assetRevisionIdentity } from '../assetRevisions';
import { llmCallEstimate } from '../budget';
import { COMMAND_REVIEW_CHANGED } from '../commands/types';
import { chat, type ChatResult, type ReasoningEffort, type ToolSpec } from '../providers/llm';
import type { Asset, LlmMessage, LlmProviderId, ProviderId, RemoteJob } from '../types';
import { atlas } from '../providers/atlas';
import { local } from '../providers/demo';
import { fal } from '../providers/fal';
import { nanogpt } from '../providers/nanogpt';
import { openrouter } from '../providers/openrouter';
import type { GenBuildRequest, GenResult, MediaInput, PreparedRequest, ProviderAdapter, RequestEncoder, TranscribeRequest } from '../providers/types';
import { paidSend, PaidSendBlockedError, sendFree } from './paidSend';
import { budgetSnapshotFor, canWriteTicket, grantTicketPass, legacyPaidSendError, saveTicketMark, sendGenerationViaPaidGate, storeTickets, type GenerationPaidSendOpts } from './storeBridge';
import { createTicket, isFreePrice, priceFromEstimate, type ApprovalTicket, type MoneyPrice } from './ticket';

type PaidMethod = 'generate' | 'transcribe' | 'createStyle' | 'createVoice';
type RequestOf<K extends PaidMethod> = Parameters<NonNullable<ProviderAdapter[K]>>[0];
export type MediaRequest = { [K in PaidMethod]: { method: K; input: RequestOf<K> } }[PaidMethod];
export type DryMediaRequest =
  | { method: 'generate'; input: GenBuildRequest }
  | { method: 'transcribe'; input: Pick<TranscribeRequest, 'model' | 'input' | 'language'> }
  | { method: 'createStyle'; input: { images: MediaInput[] } }
  | { method: 'createVoice'; input: { input: MediaInput } };

export const stable = (value: unknown): string => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b))) : v);

const DRY_BLOB = new Blob([]);
export const dryMedia = (assetId: string): MediaInput => ({ assetId, blob: DRY_BLOB, mime: '', width: 0, height: 0 });

export function buildDryRequest(provider: ProviderId, req: DryMediaRequest, assets: Record<string, Asset>, opts: { ignoreSeed?: boolean } = {}): PreparedRequest | null {
  const adapter = ADAPTERS[provider];
  const token = (m: MediaInput) => ({ asset: m.assetId, rev: assetRevisionIdentity(assets[m.assetId]) });
  const enc: RequestEncoder = { image: token, video: token, file: token };
  if (req.method === 'generate') return adapter.buildRequest?.(opts.ignoreSeed ? { ...req.input, settings: { ...req.input.settings, seed: undefined } } : req.input, enc) ?? null;
  if (req.method === 'transcribe') return adapter.buildTranscribeRequest?.(req.input, enc) ?? null;
  if (req.method === 'createStyle') return adapter.buildCreateStyleRequest?.(req.input, enc) ?? null;
  return adapter.buildCreateVoiceRequest?.(req.input, enc) ?? null;
}

function assertApprovedRequest(provider: ProviderId, req: MediaRequest, approvedFingerprint: string, chunkIndex: number): void {
  const actual = buildDryRequest(provider, req, useStore.getState().assets, { ignoreSeed: true });
  let expected: unknown;
  try { expected = JSON.parse(approvedFingerprint); } catch { expected = null; }
  if (!actual || !Array.isArray(expected) || chunkIndex >= expected.length || stable(expected[chunkIndex]) !== stable(actual)) throw new Error(COMMAND_REVIEW_CHANGED);
}

const permit = Symbol('paid transport');
type GuardedAdapter = Omit<ProviderAdapter, PaidMethod> & {
  generate(request: RequestOf<'generate'>, authority: typeof permit): Promise<GenResult>;
  transcribe?(request: RequestOf<'transcribe'>, authority: typeof permit): Promise<GenResult>;
  createStyle?(request: RequestOf<'createStyle'>, authority: typeof permit): Promise<GenResult>;
  createVoice?(request: RequestOf<'createVoice'>, authority: typeof permit): Promise<GenResult>;
};

function guardedAdapter(raw: ProviderAdapter): GuardedAdapter {
  const guard = <T>(fn: ((req: T) => Promise<GenResult>) | undefined) =>
    fn && (async (req: T, authority?: typeof permit) => { if (authority !== permit) throw new Error('Provider requests require paidSend authorization.'); return fn.call(raw, req); });
  return { ...raw, generate: guard(raw.generate)!, transcribe: guard(raw.transcribe), createStyle: guard(raw.createStyle), createVoice: guard(raw.createVoice) };
}

export const ADAPTERS: Record<ProviderId, GuardedAdapter> = {
  local: guardedAdapter(local), openrouter: guardedAdapter(openrouter), fal: guardedAdapter(fal), nanogpt: guardedAdapter(nanogpt), atlas: guardedAdapter(atlas),
};

type MediaSend = Omit<GenerationPaidSendOpts<GenResult>, 'send'> & {
  provider: ProviderId; adapter?: GuardedAdapter; chunkIndex?: number; request: (onRemoteJob: (job: RemoteJob) => void) => MediaRequest; settlement: (result: GenResult) => { costUsd: number | null; estimated: boolean };
};

export function sendMediaViaPaidGate({ provider, adapter, chunkIndex = 0, request, settlement, beforeTransport, ...options }: MediaSend) {
  return sendGenerationViaPaidGate({
    ...options,
    beforeTransport: () => {
      if (options.g.approvedFingerprint) assertApprovedRequest(provider, request(() => undefined), options.g.approvedFingerprint, chunkIndex);
      beforeTransport?.();
    },
    send: async ({ onRemoteJob }) => {
      const chosen = adapter ?? ADAPTERS[provider], req = request(onRemoteJob);
      const fn = chosen[req.method] as ((input: RequestOf<PaidMethod>, authority: typeof permit) => Promise<GenResult>) | undefined;
      if (!fn) throw new Error(`${chosen.label} cannot run ${req.method}.`);
      const value = await fn(req.input, permit);
      return { value, ...settlement(value) };
    },
  });
}

export interface LlmPaidSendOpts {
  readonly ticketId: string; readonly sessionId: string; readonly provider: LlmProviderId; readonly apiKey: string; readonly model: string;
  readonly system: string; readonly messages: LlmMessage[]; readonly tools: ToolSpec[]; readonly effort?: ReasoningEffort; readonly showReasoning?: boolean;
  readonly signal: AbortSignal; readonly budgetPass?: boolean; readonly computeUsd: (usage: ChatResult['usage']) => number;
  readonly onText?: (delta: string, full: string) => void; readonly onReasoning?: (delta: string, full: string) => void;
  readonly onToolCall?: () => void; readonly onNotice?: (text: string) => void;
}
export interface LlmPaidSendOutcome { readonly sendId: string; readonly value: ChatResult; readonly costUsd: number | null }

function ensureLlmTicket(opts: LlmPaidSendOpts, sendId: string, price: MoneyPrice, estimate: ReturnType<typeof llmCallEstimate>): ApprovalTicket {
  const existing = storeTickets.get(opts.ticketId);
  const ticket = existing ?? createTicket({ id: opts.ticketId, sessionId: opts.sessionId, kind: 'llm', scope: { llm: { provider: opts.provider, model: opts.model } }, price });
  if (opts.budgetPass) return grantTicketPass({ ...ticket, price }, estimate, { [sendId]: price.maxVerifiableUsd });
  if (!existing || ticket.pass) { const cleared = { ...ticket, pass: undefined }; storeTickets.put(cleared); return cleared; }
  return ticket;
}

export async function sendLlmViaPaidGate(opts: LlmPaidSendOpts): Promise<LlmPaidSendOutcome> {
  const estimate = llmCallEstimate(opts.provider, opts.model), price = priceFromEstimate(estimate), sendId = uid('llm');
  const { ticketId, sessionId, budgetPass: _bp, computeUsd, ...chatOptions } = opts;
  if (storeTickets.get(ticketId)?.sends.some((s) => s.status === 'uncertain' || s.status === 'in_flight')) {
    throw new PaidSendBlockedError('ALREADY_SENT', 'This model request may already have been charged.', { ticketId });
  }
  const book = (usd: number | null, estimated: boolean) => addSpend(usd, { category: 'agent', provider: opts.provider, model: opts.model, sessionId, estimated, sendId });
  try {
    if (isFreePrice(price)) {
      const outcome = await sendFree(sendId, async () => { const value = await chat(chatOptions); return { value, costUsd: value.usage?.costUsd ?? 0 }; }, opts.signal, undefined, (_, usd) => { book(usd, false); });
      return { ...outcome, costUsd: outcome.value.usage?.costUsd ?? 0 };
    }
    const ticket = ensureLlmTicket(opts, sendId, price, estimate);
    const outcome = await paidSend<ChatResult>({
      ticketId: ticket.id, prepare: { id: sendId, slotKey: `${ticket.id}:${sendId}`, stepKey: sendId, price }, tickets: storeTickets,
      getBudget: () => budgetSnapshotFor(sessionId), save: saveTicketMark, canWrite: canWriteTicket, onBookSpend: (b) => { book(b.usd, b.estimated); },
      send: async () => { const value = await chat(chatOptions), est = value.usage?.costUsd == null; return { value, costUsd: value.usage && (!est || price.kind !== 'unknown') ? computeUsd(value.usage) : null, estimated: est }; },
      signal: opts.signal, isRetryable: (err) => err instanceof HttpError && err.status === 400 && /reason|effort|think/i.test(err.message),
    }).finally(() => { const cur = storeTickets.get(ticket.id); if (cur?.pass) storeTickets.put({ ...cur, pass: undefined }); });
    return { sendId: outcome.sendId, value: outcome.value, costUsd: outcome.settled?.ticket.sends.find((s) => s.id === sendId)?.settledUsd ?? null };
  } catch (err) { throw legacyPaidSendError(err, price); }
}
