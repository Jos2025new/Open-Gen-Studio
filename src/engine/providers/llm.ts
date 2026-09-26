import { cacheDb } from '../../lib/idb';
import { AbortedError, HttpError, extractErrorMessage, isAbort, readSse, requestJson } from '../../lib/http';
import type { LlmMessage, LlmProviderId } from '../types';
import { NANO_BASE } from './nanogpt';
import { orHeaders } from './openrouter';

/* OpenAI-compatible chat completions for the agent (OpenRouter, NanoGPT, Atlas Cloud). */

export interface LlmModel {
  id: string;
  name: string;
  tools: boolean;
  /** Accepts image input (undefined when the catalog does not say). */
  vision?: boolean;
  contextLength?: number;
  /** USD per million tokens. */
  inputPrice?: number;
  outputPrice?: number;
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string | null;
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}

const ENDPOINTS: Record<LlmProviderId, { chat: string; models: string }> = {
  openrouter: { chat: 'https://openrouter.ai/api/v1/chat/completions', models: 'https://openrouter.ai/api/v1/models' },
  nanogpt: { chat: `${NANO_BASE}/v1/chat/completions`, models: `${NANO_BASE}/v1/models?detailed=true` },
  atlas: { chat: 'https://api.atlascloud.ai/v1/chat/completions', models: 'https://api.atlascloud.ai/v1/models' },
};

export const LLM_LABELS: Record<LlmProviderId, string> = {
  openrouter: 'OpenRouter',
  nanogpt: 'NanoGPT',
  atlas: 'Atlas Cloud',
};

export type AgentTier = 'normal' | 'top';

/*
 * Agent model priority, best first. Ids exactly as each provider lists them (OpenRouter and NanoGPT
 * share most ids; Atlas uses its own vendor prefixes); the first one in the live catalog wins.
 */
const NORMAL_LLM = [
  'z-ai/glm-5.3-flash', 'zai-org/glm-5.3-flash', // GLM 5.3 Flash
  'openai/gpt-6-luna', // GPT-6 Luna
  'deepseek/deepseek-v4.1-flash', 'deepseek-ai/deepseek-v4.1-flash', // DeepSeek V4.1 Flash
];
const TOP_LLM = [
  'openai/gpt-6-sol', 'openai/gpt-6-sol-codex', // GPT-6 Sol (Atlas lists it as gpt-6-sol-codex)
  'openai/gpt-5.6-sol', // GPT-5.6 Sol
  'anthropic/claude-opus-5.5', // Claude Opus 5.5
  'qwen/qwen3.8-max', 'qwen/qwen3.8-max-0902', // Qwen 3.8 Max (OpenRouter only has the dated id)
];

function headers(provider: LlmProviderId, key: string): Record<string, string> {
  if (provider === 'openrouter') return orHeaders(key);
  return { Authorization: `Bearer ${key}` };
}

type Loose = Record<string, unknown>;

function perMillion(v: unknown, unit: 'token' | 'million'): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return undefined;
  return unit === 'token' ? n * 1_000_000 : n;
}

export async function listLlmModels(provider: LlmProviderId): Promise<LlmModel[]> {
  const cacheKey = `llm:v2:${provider}`;
  const cached = await cacheDb.get<LlmModel[]>(cacheKey, 12 * 3600 * 1000);
  if (cached) return cached;
  const res = await requestJson<{ data: Loose[] }>(ENDPOINTS[provider].models);
  const out: LlmModel[] = [];
  for (const m of res.data ?? []) {
    const id = String(m.id ?? '');
    if (!id) continue;
    let tools = false;
    let vision: boolean | undefined;
    let inputPrice: number | undefined;
    let outputPrice: number | undefined;
    const pricing = (m.pricing ?? {}) as Loose;
    if (provider === 'openrouter') {
      tools = Array.isArray(m.supported_parameters) && (m.supported_parameters as string[]).includes('tools');
      vision = ((m.architecture as Loose | undefined)?.input_modalities as string[] | undefined)?.includes('image');
      inputPrice = perMillion(pricing.prompt, 'token');
      outputPrice = perMillion(pricing.completion, 'token');
    } else if (provider === 'nanogpt') {
      tools = Boolean((m.capabilities as Loose | undefined)?.tool_calling);
      vision = (m.capabilities as Loose | undefined)?.vision as boolean | undefined;
      inputPrice = perMillion(pricing.prompt, 'million');
      outputPrice = perMillion(pricing.completion, 'million');
    } else {
      tools = Array.isArray(m.supported_features) && (m.supported_features as string[]).includes('tools');
      vision = (m.input_modalities as string[] | undefined)?.includes('image');
      inputPrice = perMillion(pricing.prompt, 'token');
      outputPrice = perMillion(pricing.completion, 'token');
    }
    const outMods = (m.output_modalities ?? (m.architecture as Loose | undefined)?.output_modalities) as string[] | undefined;
    if (outMods && !outMods.includes('text')) continue;
    out.push({
      id,
      name: String(m.name ?? id).replace(/^[^:]+:\s*/, ''),
      tools,
      vision,
      contextLength: typeof m.context_length === 'number' ? m.context_length : undefined,
      inputPrice,
      outputPrice,
    });
  }
  await cacheDb.set(cacheKey, out);
  return out;
}

export const capable = (m: LlmModel) => m.tools && m.vision !== false;

/** Priority lists by tier; the model picker shows these first. */
export const LLM_TIERS: Record<AgentTier, string[]> = { normal: NORMAL_LLM, top: TOP_LLM };

/** Cheapest by input + output price per million tokens; unpriced models last. */
function cheapest(models: LlmModel[]): LlmModel | undefined {
  const cost = (m: LlmModel) => (m.inputPrice ?? Infinity) + (m.outputPrice ?? Infinity);
  return [...models].sort((a, b) => cost(a) - cost(b))[0];
}

/**
 * Default agent model: the tier's priority list (top falls back to normal), then the cheapest model with tool
 * calling and confirmed image input. Never a model that cannot see images: that one the user must accept
 * (see limitedLlmFallback).
 */
export function pickDefaultLlm(models: LlmModel[], tier: AgentTier = 'normal'): string | undefined {
  const order = tier === 'top' ? [...TOP_LLM, ...NORMAL_LLM] : NORMAL_LLM;
  for (const id of order) if (models.some((m) => m.id === id && capable(m))) return id;
  return cheapest(models.filter((m) => m.tools && m.vision === true))?.id;
}

/** When no model has tools and vision: the cheapest with tools whose vision is unknown, else none, for the user to accept or not. */
export function limitedLlmFallback(models: LlmModel[]): LlmModel | undefined {
  if (pickDefaultLlm(models)) return undefined;
  return cheapest(models.filter((m) => m.tools && m.vision === undefined)) ?? cheapest(models.filter((m) => m.tools && m.vision === false));
}

/** Stream a chat completion, reporting text deltas. */
export async function chat(opts: {
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  effort?: 'low' | 'medium' | 'high';
  signal: AbortSignal;
  onText?: (delta: string, full: string) => void;
  /** Called once, when the first tool-call fragment arrives (the plan is being written). */
  onToolCall?: () => void;
}): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [{ role: 'system', content: opts.system }, ...opts.messages],
    tools: opts.tools,
    tool_choice: 'auto',
    stream: true,
    max_tokens: 16000,
  };
  if (opts.provider === 'openrouter') {
    if (opts.effort) body.reasoning = { effort: opts.effort, exclude: true };
    body.usage = { include: true };
  }
  if (opts.provider !== 'openrouter') body.stream_options = { include_usage: true };

  let res: Response;
  try {
    res = await fetch(ENDPOINTS[opts.provider].chat, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers(opts.provider, opts.apiKey) },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbort(err)) throw new AbortedError();
    throw new Error(`Could not reach ${LLM_LABELS[opts.provider]}. Check your connection.`);
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* raw text */
    }
    throw new HttpError(res.status, extractErrorMessage(parsed, `${LLM_LABELS[opts.provider]} error ${res.status}`), parsed);
  }

  let text = '';
  let toolCallSeen = false;
  let finishReason: string | null = null;
  let usage: ChatResult['usage'];
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  for await (const payload of readSse(res.body, opts.signal)) {
    if (payload === '[DONE]') break;
    let chunk: Loose;
    try {
      chunk = JSON.parse(payload) as Loose;
    } catch {
      continue;
    }
    if (chunk.error) throw new HttpError(500, extractErrorMessage(chunk, 'Model error'), chunk);
    const u = chunk.usage as Loose | undefined;
    if (u) {
      usage = {
        inputTokens: Number(u.prompt_tokens ?? 0),
        outputTokens: Number(u.completion_tokens ?? 0),
        costUsd: typeof u.cost === 'number' ? u.cost : undefined,
      };
    }
    const choice = (chunk.choices as Loose[] | undefined)?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = String(choice.finish_reason);
    const delta = (choice.delta ?? {}) as Loose;
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      opts.onText?.(delta.content, text);
    }
    const tcs = delta.tool_calls as Array<Loose> | undefined;
    if (tcs?.length && !toolCallSeen) {
      toolCallSeen = true;
      opts.onToolCall?.();
    }
    for (const tc of tcs ?? []) {
      const idx = typeof tc.index === 'number' ? tc.index : calls.size;
      const fn = (tc.function ?? {}) as Loose;
      const cur = calls.get(idx) ?? { id: '', name: '', arguments: '' };
      if (typeof tc.id === 'string' && tc.id) cur.id = tc.id;
      if (typeof fn.name === 'string' && fn.name) cur.name = fn.name;
      if (typeof fn.arguments === 'string') cur.arguments += fn.arguments;
      calls.set(idx, cur);
    }
  }
  const toolCalls = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, c]) => ({ ...c, id: c.id || `call_${Date.now().toString(36)}_${i}` }))
    .filter((c) => c.name);
  return { text, toolCalls, finishReason, usage };
}
