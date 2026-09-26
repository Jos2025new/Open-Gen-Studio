import type { SpendCategory, SpendEntry } from './types';

/* Aggregates of the spend log for the Spending panel. Pure: the panel passes the log and the period. */

export type SpendPeriod = 'today' | '7d' | '30d' | 'all';

export const CATEGORY_LABELS: Record<SpendCategory, string> = {
  agent: 'Agent (LLM)',
  image: 'Images',
  video: 'Video',
  audio: 'Audio',
  model3d: '3D',
  text: 'Text results',
};

export function periodStart(period: SpendPeriod, now = Date.now()): number {
  if (period === 'all') return 0;
  if (period === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return now - (period === '7d' ? 7 : 30) * 86_400_000;
}

export interface SpendRow {
  key: string;
  usd: number;
  count: number;
  /** Some of the amount comes from published prices, not from the provider's bill. */
  estimated: boolean;
}

export interface SpendSummary {
  total: number;
  agent: number;
  media: number;
  count: number;
  byCategory: SpendRow[];
  byModel: SpendRow[];
  byProvider: SpendRow[];
  bySession: SpendRow[];
  /** Newest first. */
  recent: SpendEntry[];
}

function group(entries: SpendEntry[], key: (e: SpendEntry) => string): SpendRow[] {
  const rows = new Map<string, SpendRow>();
  for (const e of entries) {
    const k = key(e);
    const r = rows.get(k) ?? { key: k, usd: 0, count: 0, estimated: false };
    r.usd += e.usd;
    r.count += 1;
    r.estimated ||= e.estimated;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => b.usd - a.usd);
}

export function summarizeSpend(log: SpendEntry[], since: number, recent = 30): SpendSummary {
  const entries = log.filter((e) => e.at >= since);
  const total = entries.reduce((s, e) => s + e.usd, 0);
  const agent = entries.filter((e) => e.category === 'agent').reduce((s, e) => s + e.usd, 0);
  return {
    total,
    agent,
    media: total - agent,
    count: entries.length,
    byCategory: group(entries, (e) => e.category),
    byModel: group(entries, (e) => e.model),
    byProvider: group(entries, (e) => e.provider),
    bySession: group(entries, (e) => e.sessionId),
    recent: entries.slice(-recent).reverse(),
  };
}
