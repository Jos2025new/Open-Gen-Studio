import { formatUsd } from '../lib/format';
import { PLACE_LABEL, type Place } from './placeTypes';
import type { LlmProviderId, Workspace } from './types';

export interface ChatMessageUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface ChatMessageMeta {
  /** IANA time zone (or offset) captured when the message was created. */
  timeZone?: string;
  /** Agent name/role (e.g. 'Director', 'Local planner'). */
  agent?: string;
  /** Space where the message was written. */
  space?: Place;
  /** Provider id ('openrouter' | 'nanogpt' | 'atlas' | 'offline'). */
  provider?: LlmProviderId | 'offline';
  /** Model id (or 'Local planner'). */
  model?: string;
  /** Token usage of the LLM call(s) that produced this message. */
  usage?: ChatMessageUsage;
  /** USD cost of the LLM call(s) that produced this message. */
  costUsd?: number;
  /** True when costUsd was estimated from catalog prices rather than provider-reported. */
  costEstimated?: boolean;
  /** Run / turn id when this message belongs to a run or turn. */
  runId?: string;
}

const PROVIDER_NAME: Record<LlmProviderId | 'offline', string> = {
  openrouter: 'OpenRouter',
  nanogpt: 'NanoGPT',
  atlas: 'Atlas Cloud',
  offline: 'Local',
};

export function providerLabel(provider: LlmProviderId | 'offline' | undefined): string {
  return provider ? (PROVIDER_NAME[provider] ?? provider) : '';
}

export function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function spaceOfFeedItem(item: { workspace: Workspace; meta?: ChatMessageMeta }): Place {
  if (item.meta?.space) return item.meta.space;
  return item.workspace === 'node' ? 'canvas' : item.workspace === 'designer' ? 'designer' : 'studio';
}

export function spaceLabelOf(item: { workspace: Workspace; meta?: ChatMessageMeta }): string {
  return PLACE_LABEL[spaceOfFeedItem(item)];
}

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
};

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
let defaultDateTimeFormatter: Intl.DateTimeFormat | undefined;

function dateTimeFormatterFor(timeZone?: string): Intl.DateTimeFormat {
  if (timeZone) {
    const cached = dateTimeFormatters.get(timeZone);
    if (cached) return cached;
    try {
      const fmt = new Intl.DateTimeFormat(undefined, { ...DATE_TIME_OPTIONS, timeZone });
      dateTimeFormatters.set(timeZone, fmt);
      return fmt;
    } catch {
      // Unknown or invalid IANA time zone falls back to local time zone.
    }
  }
  return (defaultDateTimeFormatter ??= new Intl.DateTimeFormat(undefined, DATE_TIME_OPTIONS));
}

export function formatMessageDateTime(ts: number, timeZone?: string): string {
  return dateTimeFormatterFor(timeZone).format(ts);
}

export function shortModelName(model: string): string {
  return model.replace(/^[^/]+\//, '');
}

export function formatMessageUsage(usage: ChatMessageUsage): string {
  return `${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`;
}

export function formatMessageUsageDetail(usage: ChatMessageUsage): string {
  const parts = [`${usage.inputTokens.toLocaleString()} in`, `${usage.outputTokens.toLocaleString()} out`];
  if (usage.cachedTokens) parts.push(`${usage.cachedTokens.toLocaleString()} cached`);
  if (usage.reasoningTokens) parts.push(`${usage.reasoningTokens.toLocaleString()} reasoning`);
  return parts.join(' · ');
}

export interface MessageMetaSummary {
  spaceLabel: string;
  dateTime: string;
  timeZone?: string;
  agent?: string;
  provider?: string;
  model?: string;
  fullModel?: string;
  usage?: string;
  cost?: string;
  runId?: string;
  detailParts: string[];
  tooltip: string;
}

export function buildMessageMetaSummary(item: {
  type: 'user' | 'assistant';
  createdAt: number;
  workspace: Workspace;
  engine?: string;
  meta?: ChatMessageMeta;
}): MessageMetaSummary {
  const m = item.meta;
  const spaceLabel = spaceLabelOf(item);
  const dateTime = formatMessageDateTime(item.createdAt, m?.timeZone);
  const agent = m?.agent ?? (item.type === 'assistant' ? (item.engine === 'Local planner' ? 'Local planner' : 'Director') : undefined);
  const provider = m?.provider ? providerLabel(m.provider) : undefined;
  const fullModel = m?.model;
  const model = fullModel ? shortModelName(fullModel) : (item.type === 'assistant' && !m && item.engine !== 'Local planner' ? item.engine : undefined);
  const usage = m?.usage ? formatMessageUsage(m.usage) : undefined;
  const usageDetail = m?.usage ? formatMessageUsageDetail(m.usage) : undefined;
  const cost = m?.costUsd != null ? formatUsd(m.costUsd, { approx: m.costEstimated }) : undefined;
  const runId = m?.runId;

  const modelPart = model && model !== agent
    ? (provider ? `${model} (${provider})` : model)
    : provider;
  const detailParts = [
    agent,
    modelPart,
    usage,
    cost,
    runId ? `run ${runId}` : undefined,
  ].filter((x): x is string => Boolean(x));

  const tipParts = [
    `Time: ${dateTime}${m?.timeZone ? ` (${m.timeZone})` : ''}`,
    `Space: ${spaceLabel}`,
    agent ? `Agent: ${agent}` : undefined,
    provider ? `Provider: ${provider}` : undefined,
    fullModel ? `Model: ${fullModel}` : (model ? `Model: ${model}` : undefined),
    usageDetail ? `Usage: ${usageDetail}` : undefined,
    cost ? `Cost: ${cost}${m?.costEstimated ? ' (est.)' : ''}` : undefined,
    runId ? `Run: ${runId}` : undefined,
  ].filter((x): x is string => Boolean(x));

  return {
    spaceLabel,
    dateTime,
    timeZone: m?.timeZone,
    agent,
    provider,
    model,
    fullModel,
    usage,
    cost,
    runId,
    detailParts,
    tooltip: tipParts.join(' · '),
  };
}
