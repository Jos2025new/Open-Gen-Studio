/* Spending per request: each send record carries its own cost and what was already booked (envíos D).
 * A delivered request is booked once, when it delivers, whoever notices it (the run, a recovery, Check status).
 * The generation's spend is the sum of its records. Generations without `sends` (older data) keep the old path. */
import { uid } from '../lib/id';
import { patchGeneration, useStore } from '../store/store';
import { addSpend } from '../store/spend';
import type { Generation, SendRecord } from './types';

const get = useStore.getState;

/** True when this generation books its spend per request (it has a send ledger). */
export function usesLedger(g: Pick<Generation, 'sends'> | undefined): boolean {
  return Boolean(g?.sends);
}

/** The proportional estimate of `items` results when the provider reports no cost and there was no quote; undefined when the price is unknown. */
export function shareOfEstimate(g: Generation, items: number): number | undefined {
  const base = (g.retryBaseEstimate ?? g.estimate).usd;
  const expected = g.retryTotal ?? (g.variants ? g.assetIds.length + g.variants.length : g.settings.count);
  return base != null && expected > 0 ? base * items / expected : undefined;
}

function spendEntry(g: Generation, estimated: boolean) {
  return { category: g.kind, provider: g.modelRef.split('::')[0], model: g.modelRef, sessionId: g.sessionId, estimated };
}

/** Book the records that delivered and were not booked yet; returns the updated list. Idempotent. */
function bookPending(g: Generation, sends: SendRecord[]): SendRecord[] {
  return sends.map((s) => {
    if (s.status !== 'done' || s.bookedUsd != null || s.bookedUnknown) return s;
    if (s.costUsd == null) {
      if (!s.estimated) return s;
      addSpend(null, spendEntry(g, true));
      return { ...s, bookedUnknown: true };
    }
    addSpend(s.costUsd, spendEntry(g, Boolean(s.estimated)));
    return { ...s, bookedUsd: s.costUsd };
  });
}

/**
 * A request delivered: mark its record done with its cost (or unset when unknown) and book it, once. A request
 * without a record (a free send, a job adopted by Check status) gets one so the ledger stays the whole story.
 */
export function deliverSend(id: string, reqId: string | undefined, index: number, costUsd: number | undefined, estimated: boolean): SendRecord[] | undefined {
  const g = get().generations[id];
  if (!g) return undefined;
  const list = g.sends ?? [];
  const at = reqId ? list.findIndex((s) => s.id === reqId) : -1;
  const prev = at >= 0 ? list[at] : undefined;
  const alreadyBooked = prev?.bookedUsd != null || prev?.bookedUnknown;
  const rec: SendRecord = alreadyBooked
    ? { ...prev, status: 'done' }
    : { ...(prev ?? { id: reqId ?? uid('req'), index }), status: 'done', ...(costUsd != null ? { costUsd } : {}), estimated };
  const next = at >= 0 ? list.map((s, i) => (i === at ? rec : s)) : [...list, rec];
  const sends = bookPending(g, next);
  patchGeneration(id, { sends });
  return sends;
}

/** Book any delivered record still unbooked (a cut-short or ended run). Idempotent; no-op without a ledger. */
export function bookDelivered(id: string): void {
  const g = get().generations[id];
  if (!g?.sends) return;
  const sends = bookPending(g, g.sends);
  if (sends.some((s, i) => s !== g.sends![i])) patchGeneration(id, { sends });
}

/** What the generation cost by its records: the sum, whether every amount was reported or quoted, and if any had an unknown price. */
export function ledgerCost(g: Pick<Generation, 'sends'>): { usd: number; known: boolean; estimatedUsd: number; hasUnknown: boolean } {
  const done = (g.sends ?? []).filter((s) => s.status === 'done');
  const priced = done.filter((s) => s.costUsd != null);
  const hasUnknown = done.some((s) => s.costUsd == null);
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return {
    usd: round(priced.reduce((n, s) => n + s.costUsd!, 0)),
    known: done.length > 0 && !hasUnknown && priced.every((s) => !s.estimated),
    // Sum of estimated-only priced sends; when `hasUnknown` is true, `usd` is only a lower bound, not the full cost.
    estimatedUsd: round(priced.filter((s) => s.estimated).reduce((n, s) => n + s.costUsd!, 0)),
    hasUnknown,
  };
}
