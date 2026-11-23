import { formatUsd } from '../lib/format';
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
  lastAt: number;
  /** Some of the amount comes from published prices, not from the provider's bill. */
  estimated: boolean;
  /** Number of charges in this group whose price was unknown (never confirmed $0). */
  unknownCount: number;
}

export interface SpendSummary {
  total: number;
  agent: number;
  media: number;
  count: number;
  /** Charges in this period whose price was unknown; totals above are lower bounds when > 0. */
  unknownCount: number;
  unknownAgent: number;
  unknownMedia: number;
  byCategory: SpendRow[];
  byModel: SpendRow[];
  byProvider: SpendRow[];
  bySession: SpendRow[];
  /** Newest first. */
  recent: SpendEntry[];
}

/** Format a spending amount or total: unknown-price charges never display as confirmed $0. */
export function formatSpendAmount(usd: number, opts: { estimated?: boolean; unknown?: boolean; fixed?: boolean } = {}): string {
  const { estimated = false, unknown = false, fixed = false } = opts;
  if (unknown && usd === 0) return 'Price unknown';
  const base = fixed && (Math.abs(usd) >= 0.1 || usd === 0)
    ? `${estimated ? '≈' : ''}$${usd.toFixed(2)}`
    : formatUsd(usd, { approx: estimated });
  return unknown ? `≥${base}` : base;
}

function group(entries: SpendEntry[], key: (e: SpendEntry) => string): SpendRow[] {
  const rows = new Map<string, SpendRow>();
  for (const e of entries) {
    const k = key(e);
    const r = rows.get(k) ?? { key: k, usd: 0, count: 0, lastAt: 0, estimated: false, unknownCount: 0 };
    r.lastAt = Math.max(r.lastAt, e.at);
    r.usd += e.usd ?? 0;
    r.count += 1;
    r.estimated ||= e.estimated;
    if (e.unknownPrice) r.unknownCount += 1;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => b.usd - a.usd || b.count - a.count);
}

export function summarizeSpend(log: SpendEntry[], since: number, recent = 30): SpendSummary {
  const entries = log.filter((e) => e.at >= since);
  const total = entries.reduce((s, e) => s + (e.usd ?? 0), 0);
  const agent = entries.filter((e) => e.category === 'agent').reduce((s, e) => s + (e.usd ?? 0), 0);
  const unknownCount = entries.filter((e) => e.unknownPrice).length;
  const unknownAgent = entries.filter((e) => e.category === 'agent' && e.unknownPrice).length;
  return {
    total,
    agent,
    media: total - agent,
    count: entries.length,
    unknownCount,
    unknownAgent,
    unknownMedia: unknownCount - unknownAgent,
    byCategory: group(entries, (e) => e.category),
    byModel: group(entries, (e) => e.model),
    byProvider: group(entries, (e) => e.provider),
    bySession: group(entries, (e) => e.sessionId),
    recent: entries.slice(-recent).reverse(),
  };
}
