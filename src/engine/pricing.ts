import type { Estimate, PriceRule, PriceSku } from './types';

export interface EstimateContext {
  count: number;
  duration?: number;
  /** Longest duration the model allows; prices an automatic duration (-1). */
  maxDuration?: number;
  resolution?: string;
  audio?: boolean;
  mode?: 'text' | 'image';
  megapixels?: number;
}

export const FREE: Estimate = { usd: 0, approximate: false };
export const UNKNOWN: Estimate = { usd: null, approximate: true, note: 'Price not published for this model' };

export function normRes(v: string | undefined): string | undefined {
  if (v == null) return undefined;
  return String(v).trim().toLowerCase().replace(/\s+/g, '').replace('*', 'x');
}

function matches(sku: PriceSku, ctx: EstimateContext, ignoreRes: boolean): boolean {
  if (!ignoreRes && sku.resolution != null && normRes(sku.resolution) !== normRes(ctx.resolution)) return false;
  if (sku.audio != null && sku.audio !== Boolean(ctx.audio)) return false;
  if (sku.mode != null && ctx.mode != null && sku.mode !== ctx.mode) return false;
  if (sku.duration != null && sku.duration !== ctx.duration) return false;
  return true;
}

function specificity(s: PriceSku): number {
  return (s.resolution != null ? 1 : 0) + (s.audio != null ? 1 : 0) + (s.mode != null ? 1 : 0) + (s.duration != null ? 2 : 0);
}

/** Estimate the USD cost of a request from a normalized price rule. */
export function estimate(rule: PriceRule | undefined, ctx: EstimateContext): Estimate {
  if (!rule) return UNKNOWN;
  if (!rule.skus.length) {
    if (rule.minimumUsd != null) {
      return { usd: rule.minimumUsd * Math.max(1, ctx.count), approximate: true, lowerBound: true, note: rule.note ?? 'Minimum price' };
    }
    return { ...UNKNOWN, note: rule.note ?? UNKNOWN.note };
  }
  let approximate = Boolean(rule.approximate);
  let candidates = rule.skus.filter((s) => matches(s, ctx, false));
  if (!candidates.length) {
    candidates = rule.skus.filter((s) => matches(s, ctx, true));
    if (candidates.length) approximate = true;
  }
  if (!candidates.length) {
    candidates = [...rule.skus];
    approximate = true;
  }
  const sku = candidates.reduce((best, s) => (specificity(s) > specificity(best) ? s : best), candidates[0]);
  const count = Math.max(1, ctx.count);
  let usd: number;
  let durationNote: string | undefined;
  switch (sku.unit) {
    case 'output':
      usd = sku.usd * count;
      break;
    case 'second': {
      // 0 or less (-1) means the model picks the length: price the longest it allows, never a negative amount.
      const known = ctx.duration != null && ctx.duration > 0 ? ctx.duration : undefined;
      const seconds = known ?? ctx.maxDuration ?? 5;
      if (known == null) approximate = true;
      if (ctx.duration != null && known == null) durationNote = `Automatic duration, priced at ${seconds}s${ctx.maxDuration != null ? ' (the longest)' : ''}`;
      usd = sku.usd * seconds * count;
      break;
    }
    case 'megapixel': {
      if (ctx.megapixels == null) approximate = true;
      usd = sku.usd * Math.max(1, Math.ceil(ctx.megapixels ?? 1)) * count;
      break;
    }
  }
  if (ctx.audio && sku.audio == null && rule.audioMultiplier) usd *= rule.audioMultiplier;
  if (rule.minimumUsd != null && usd < rule.minimumUsd * count) usd = rule.minimumUsd * count;
  const note = [durationNote, rule.note].filter(Boolean).join('. ') || undefined;
  return { usd: round4(usd), approximate, lowerBound: rule.lowerBound || undefined, note };
}

export function sumEstimates(parts: Estimate[]): Estimate {
  let usd = 0;
  let approximate = false;
  let unknown = 0;
  for (const p of parts) {
    if (p.usd == null) {
      unknown++;
      approximate = true;
      continue;
    }
    usd += p.usd;
    approximate ||= p.approximate;
    if (p.lowerBound) unknown++;
  }
  if (unknown && unknown === parts.length && usd === 0) {
    return { usd: null, approximate: true, note: 'Price not published for these models' };
  }
  return {
    usd: round4(usd),
    approximate,
    lowerBound: unknown > 0 || undefined,
    note: unknown ? `${unknown} item${unknown > 1 ? 's' : ''} without a published price` : undefined,
  };
}

/** True when running this would (or might) spend money and therefore needs a cost check first. */
export function needsSpendCheck(e: Estimate): boolean {
  return e.usd == null || e.usd > 0 || Boolean(e.lowerBound);
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
