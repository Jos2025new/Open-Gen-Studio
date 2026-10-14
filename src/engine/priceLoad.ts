import { imagePrice } from './providers/openrouter';
import { setCatalog, useStore } from '../store/store';

/** Price lookups in flight at once: each is one request to OpenRouter, so the selector never floods it. */
const LIMIT = 3;
const queued: string[] = [];
const pending = new Set<string>();
let running = 0;

/**
 * Load the price of an OpenRouter image model in the background (the listing has none for images). The row shows
 * «loading» until it lands; a failed lookup is marked «failed» and not cached, so it can be asked again later.
 * Repeated requests for a model already queued or loaded do nothing.
 */
export function requestImagePrice(ref: string): void {
  const { models, priceState } = useStore.getState().catalog;
  const m = models[ref];
  if (!m || m.provider !== 'openrouter' || m.kind !== 'image' || m.price) return;
  if (pending.has(ref) || priceState[ref] === 'failed') return;
  pending.add(ref);
  queued.push(ref);
  setCatalog((c) => ({ priceState: { ...c.priceState, [ref]: 'loading' } }));
  pump();
}

function pump(): void {
  while (running < LIMIT && queued.length) {
    const ref = queued.shift()!;
    running++;
    void load(ref).finally(() => {
      running--;
      pending.delete(ref);
      pump();
    });
  }
}

async function load(ref: string): Promise<void> {
  const model = useStore.getState().catalog.models[ref];
  if (!model) return;
  const rule = await imagePrice(model.id);
  setCatalog((c) => {
    const { [ref]: _done, ...rest } = c.priceState;
    if (!rule) return { priceState: { ...rest, [ref]: 'failed' } };
    const current = c.models[ref];
    return { priceState: rest, models: current ? { ...c.models, [ref]: { ...current, price: rule } } : c.models };
  });
}
