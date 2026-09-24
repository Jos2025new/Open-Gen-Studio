import { cacheDb } from '../../lib/idb';
import { AbortedError, HttpError, extractErrorMessage, isAbort, readSse, requestJson } from '../../lib/http';
import type { LlmMessage, LlmProviderId } from '../types';
import { orHeaders } from './openrouter';

/* OpenAI-compatible chat completions for the agent (OpenRouter, NanoGPT, Atlas Cloud). */

export interface LlmModel {
  id: string;
  name: string;
  tools: boolean;
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
  nanogpt: { chat: 'https://api.nano-gpt.com/api/v1/chat/completions', models: 'https://api.nano-gpt.com/api/v1/models?detailed=true' },
  atlas: { chat: 'https://api.atlascloud.ai/v1/chat/completions', models: 'https://api.atlascloud.ai/v1/models' },
};

export const LLM_LABELS: Record<LlmProviderId, string> = {
  openrouter: 'OpenRouter',
  nanogpt: 'NanoGPT',
  atlas: 'Atlas Cloud',
};

/** Preferred agent models, first match in the live list wins. */
export const PREFERRED_LLM = ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5', 'anthropic/claude-opus-4.8', 'anthropic/claude-sonnet-4.6'];

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
  const cacheKey = `llm:${provider}`;
  const cached = await cacheDb.get<LlmModel[]>(cacheKey, 12 * 3600 * 1000);
  if (cached) return cached;
  const res = await requestJson<{ data: Loose[] }>(ENDPOINTS[provider].models);
  const out: LlmModel[] = [];
  for (const m of res.data ?? []) {
    const id = String(m.id ?? '');
    if (!id) continue;
    let tools = false;
    let inputPrice: number | undefined;
    let outputPrice: number | undefined;
    const pricing = (m.pricing ?? {}) as Loose;
    if (provider === 'openrouter') {
      tools = Array.isArray(m.supported_parameters) && (m.supported_parameters as string[]).includes('tools');
      inputPrice = perMillion(pricing.prompt, 'token');
      outputPrice = perMillion(pricing.completion, 'token');
    } else if (provider === 'nanogpt') {
      tools = Boolean((m.capabilities as Loose | undefined)?.tool_calling);
      inputPrice = perMillion(pricing.prompt, 'million');
      outputPrice = perMillion(pricing.completion, 'million');
    } else {
      tools = Array.isArray(m.supported_features) && (m.supported_features as string[]).includes('tools');
      inputPrice = perMillion(pricing.prompt, 'token');
      outputPrice = perMillion(pricing.completion, 'token');
    }
    const outMods = (m.output_modalities ?? (m.architecture as Loose | undefined)?.output_modalities) as string[] | undefined;
    if (outMods && !outMods.includes('text')) continue;
    out.push({
      id,
      name: String(m.name ?? id).replace(/^[^:]+:\s*/, ''),
      tools,
      contextLength: typeof m.context_length === 'number' ? m.context_length : undefined,
      inputPrice,
      outputPrice,
    });
  }
  await cacheDb.set(cacheKey, out);
  return out;
}

export function pickDefaultLlm(models: LlmModel[]): string | undefined {
  for (const id of PREFERRED_LLM) if (models.some((m) => m.id === id)) return id;
  return models.find((m) => m.tools)?.id;
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
