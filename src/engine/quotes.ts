import { useStore } from '../store/store';
import { maxCountPerRequest, wireParams } from './params';
import { ADAPTERS } from './providers/registry';
import { parseModelRef } from './providers/types';
import type { GenSettings, ModelSchema } from './types';

const get = useStore.getState;
const inflight = new Map<string, Promise<number | null>>();

function keyOf(ref: string, schema: ModelSchema, settings: GenSettings, count: number): string {
  return JSON.stringify([ref, wireParams(schema, settings, count)]);
}

/** One quote per distinct request, shared by the estimate and send (null = no quote). */
export function requestQuote(ref: string, schema: ModelSchema, settings: GenSettings, count: number, timeoutMs?: number): Promise<number | null> {
  const parsed = parseModelRef(ref);
  const adapter = parsed && ADAPTERS[parsed.provider];
  const quote = adapter?.quote;
  if (!parsed || !quote) return Promise.resolve(null);
  const key = keyOf(ref, schema, settings, count);
  const known = get().quotes[key];
  if (known !== undefined) return Promise.resolve(known);
  const running = inflight.get(key);
  if (running) return running;
  const run = (async () => {
    let price: number | null = null;
    try {
      price = await quote.call(adapter, { ref, ...parsed }, schema, settings, count, timeoutMs);
    } catch { /* a quote failure leaves the catalog estimate in place */ }
    useStore.setState((s) => ({ quotes: { ...s.quotes, [key]: price } }));
    return price;
  })().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

/**
 * The exact price of a model request if it is already known; otherwise it is requested in the background
 * (the estimate shows meanwhile and is replaced when the quote arrives). Undefined without adapter support, for a
 * model whose schema has not loaded, or while no quote is known.
 */
export function knownQuote(ref: string, settings: GenSettings, requestMissing = true): number | undefined {
  const parsed = parseModelRef(ref);
  if (!parsed || !ADAPTERS[parsed.provider]?.quote) return undefined;
  const schema = get().catalog.schemas[ref];
  if (!schema) return undefined;
  // The run splits the count into requests the model accepts (one image each when it has no count field):
  // the price is each request's quote, added up — the same sum the run charges.
  const total = Math.max(1, settings.count);
  const per = Math.max(1, Math.min(total, maxCountPerRequest(schema)));
  const sizes = [...Array(Math.floor(total / per)).fill(per), ...(total % per ? [total % per] : [])];
  let sum = 0;
  for (const n of [...new Set(sizes)]) {
    const key = keyOf(ref, schema, settings, n);
    const q = get().quotes[key];
    if (requestMissing && q === undefined && !inflight.has(key)) queueMicrotask(() => void requestQuote(ref, schema, settings, n, 6000));
    if (q == null) return undefined;
    sum += q * sizes.filter((x) => x === n).length;
  }
  return sum;
}

/** The plan card's price recheck: forget the quotes known for this request and ask the adapter again. */
export function requote(ref: string, settings: GenSettings): void {
  const parsed = parseModelRef(ref);
  const schema = get().catalog.schemas[ref];
  if (!parsed || !ADAPTERS[parsed.provider]?.quote || !schema) return;
  const keys = new Set(Array.from({ length: Math.max(1, settings.count) }, (_, i) => keyOf(ref, schema, settings, i + 1)));
  useStore.setState((s) => ({ quotes: Object.fromEntries(Object.entries(s.quotes).filter(([k]) => !keys.has(k))) }));
  knownQuote(ref, settings, true);
}
