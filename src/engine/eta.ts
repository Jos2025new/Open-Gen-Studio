import type { Generation } from './types';

/** How long a generation of this model usually takes, from past ones that finished (derived; nothing is stored). */
export const ETA_SAMPLES = 20;
export const ETA_MIN_SAMPLES = 3;

/** Same model, same operation (if any), same kind. */
export const etaKey = (g: Pick<Generation, 'kind' | 'modelRef' | 'op'>): string => `${g.kind}|${g.modelRef}|${g.op?.id ?? ''}`;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type EtaIndex = Map<string, number>;

/** One pass over the generations: key -> median duration (ms) of the last ETA_SAMPLES done ones; keys under ETA_MIN_SAMPLES are left out. */
export function buildEtaIndex(generations: Record<string, Generation>): EtaIndex {
  const by = new Map<string, Array<{ at: number; ms: number }>>();
  for (const g of Object.values(generations)) {
    if (g.status !== 'done' || g.startedAt == null || g.finishedAt == null) continue;
    const ms = g.finishedAt - g.startedAt;
    if (!(ms > 0)) continue;
    const k = etaKey(g);
    const list = by.get(k);
    if (list) list.push({ at: g.finishedAt, ms }); else by.set(k, [{ at: g.finishedAt, ms }]);
  }
  const out: EtaIndex = new Map();
  for (const [k, list] of by) {
    if (list.length < ETA_MIN_SAMPLES) continue;
    const last = list.sort((a, b) => b.at - a.at).slice(0, ETA_SAMPLES);
    out.set(k, median(last.map((x) => x.ms))!);
  }
  return out;
}

let cache: { ref: Record<string, Generation>; index: EtaIndex } | null = null;
/** The index for these generations, rebuilt only when the record is a new object. */
export function etaIndex(generations: Record<string, Generation>): EtaIndex {
  if (cache?.ref !== generations) cache = { ref: generations, index: buildEtaIndex(generations) };
  return cache.index;
}

const fmt = (ms: number): string => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
};

/** "~45 s typical · ~20 s left", or "taking longer than usual" once past it. Never negative. */
export function etaLabel(typicalMs: number, elapsedMs: number): string {
  const left = typicalMs - Math.max(0, elapsedMs);
  return left > 0 ? `~${fmt(typicalMs)} typical · ~${fmt(left)} left` : 'taking longer than usual';
}
