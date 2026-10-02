import { parseModelRef } from './providers/types';
import { maxCountPerRequest, wireParams } from './params';
import type { GenSettings, ModelSchema } from './types';
import { useStore } from '../store/store';

/*
 * Exact price of an Atlas request before running it (C3, PLAN_ROUTING_COST.md). Atlas prices a request without
 * running it, without a key and at no cost (POST /api/v1/model/calculate → data.price); the quotes match the
 * real charges (PRECIOS_VIDEO.md). The body is the one the request would send (model + parameters + prompt),
 * without media. It is an HTTP request, not a model call. A quote never blocks: until it arrives, or if it
 * fails, the estimate from catalog prices stays.
 * Unverified from the cloud session (Atlas was blocked by its network): the exact body shape the endpoint
 * expects. If it differs, quotes fail quietly and the estimate stays.
 */

export const ATLAS_QUOTE_URL = 'https://api.atlascloud.ai/api/v1/model/calculate';
const QUOTE_PROMPT = 'price quote';
const get = useStore.getState;
const inflight = new Map<string, Promise<number | null>>();

/** The body Atlas would receive for this request, minus media. */
export function atlasQuoteBody(modelId: string, schema: ModelSchema, settings: GenSettings, count = settings.count): Record<string, unknown> {
  const body: Record<string, unknown> = { model: modelId, ...wireParams(schema, settings, Math.max(1, count)) };
  if (schema.slots.prompt) body[schema.slots.prompt] = QUOTE_PROMPT;
  return body;
}

/** `data.price` (or `price`), in USD; null when the answer has none. */
export function parseAtlasQuote(json: unknown): number | null {
  const o = (json ?? {}) as { data?: { price?: unknown }; price?: unknown };
  const raw = o.data?.price ?? o.price;
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function keyOf(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

/** Ask Atlas once per distinct request; the answer is kept for the session (null = no quote). */
export function fetchAtlasQuote(body: Record<string, unknown>, timeoutMs = 6000): Promise<number | null> {
  const key = keyOf(body);
  const known = get().quotes[key];
  if (known !== undefined) return Promise.resolve(known);
  const running = inflight.get(key);
  if (running) return running;
  const run = (async () => {
    let price: number | null = null;
    try {
      const res = await fetch(ATLAS_QUOTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) price = parseAtlasQuote(await res.json());
    } catch {
      price = null;
    }
    useStore.setState((s) => ({ quotes: { ...s.quotes, [key]: price } }));
    inflight.delete(key);
    return price;
  })();
  inflight.set(key, run);
  return run;
}

/**
 * The exact price of an Atlas model request if it is already known; otherwise it is requested in the background
 * (the estimate shows meanwhile and is replaced when the quote arrives). Undefined for other providers, for a
 * model whose schema has not loaded, or while no quote is known.
 */
export function knownAtlasQuote(ref: string, settings: GenSettings): number | undefined {
  const parsed = parseModelRef(ref);
  if (parsed?.provider !== 'atlas') return undefined;
  const schema = get().catalog.schemas[ref];
  if (!schema) return undefined;
  // The run splits the count into requests the model accepts (one image each when it has no count field):
  // the price is each request's quote, added up — the same sum the run charges.
  const total = Math.max(1, settings.count);
  const per = Math.max(1, Math.min(total, maxCountPerRequest(schema)));
  const sizes = [...Array(Math.floor(total / per)).fill(per), ...(total % per ? [total % per] : [])];
  let sum = 0;
  for (const n of [...new Set(sizes)]) {
    const body = atlasQuoteBody(parsed.id, schema, settings, n);
    const q = get().quotes[keyOf(body)];
    if (q === undefined && !inflight.has(keyOf(body))) queueMicrotask(() => void fetchAtlasQuote(body));
    if (q == null) return undefined;
    sum += q * sizes.filter((x) => x === n).length;
  }
  return sum;
}
