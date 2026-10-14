import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));

const cache = new Map<string, unknown>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async (k: string) => cache.get(k), set: async (k: string, v: unknown) => void cache.set(k, v) },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { requestImagePrice } from '../src/engine/priceLoad';
import { estimateMedia } from '../src/engine/costs';
import { setCatalog, useStore } from '../src/store/store';
import type { GenSettings, ModelSummary } from '../src/engine/types';

const REF = 'openrouter::acme/pic-1';
const model: ModelSummary = { ref: REF, provider: 'openrouter', id: 'acme/pic-1', name: 'Pic 1', kind: 'image', acceptsText: true, acceptsImage: false, tags: [] };
const settings = { count: 1, advanced: {} } as GenSettings;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const priced = { endpoints: [{ pricing: [{ billable: 'image_output', unit: 'image', cost_usd: 0.04 }] }] };

/** Resolves once the loader has no price in flight for the ref (polls the store, no timers). */
async function settled(ref: string) {
  for (let i = 0; i < 200 && useStore.getState().catalog.priceState[ref] === 'loading'; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  cache.clear();
  setCatalog({ models: { [REF]: model }, schemas: {}, priceState: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('OpenRouter image price on demand (fix 1)', () => {
  it('a model without a cached price shows «loading», then its price in the row and in the estimate', async () => {
    vi.stubGlobal('fetch', async (url: string) => (url.endsWith('/endpoints') ? json(priced) : json({ data: [] })));
    requestImagePrice(REF);
    expect(useStore.getState().catalog.priceState[REF]).toBe('loading');
    expect(useStore.getState().catalog.models[REF].price).toBeUndefined();
    await settled(REF);
    expect(useStore.getState().catalog.priceState[REF]).toBeUndefined();
    expect(useStore.getState().catalog.models[REF].price).toEqual({ skus: [{ unit: 'output', usd: 0.04 }] });
    const e = estimateMedia(REF, 'image', settings, false);
    expect(e.usd).toBe(0.04);
    expect(e.approximate).toBe(false);
  });

  it('a failed lookup is «failed», has no price, is not cached, and is not asked again in a loop', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return json({ error: 'boom' }, 500);
    });
    requestImagePrice(REF);
    await settled(REF);
    expect(useStore.getState().catalog.priceState[REF]).toBe('failed');
    expect(useStore.getState().catalog.models[REF].price).toBeUndefined();
    expect([...cache.keys()].filter((k) => k.startsWith('or:price'))).toEqual([]);
    requestImagePrice(REF);
    await settled(REF);
    expect(calls).toBe(1);
  });

  it('asks once for a model already in flight', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/endpoints')) calls++;
      return url.endsWith('/endpoints') ? json(priced) : json({ data: [] });
    });
    requestImagePrice(REF);
    requestImagePrice(REF);
    await settled(REF);
    expect(calls).toBe(1);
  });

  it('never has more than three lookups in flight', async () => {
    const refs = Array.from({ length: 8 }, (_, i) => `openrouter::acme/pic-${i}`);
    setCatalog({ models: Object.fromEntries(refs.map((r, i) => [r, { ...model, ref: r, id: `acme/pic-${i}` }])) });
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (!url.endsWith('/endpoints')) return json({ data: [] });
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return json(priced);
    });
    refs.forEach(requestImagePrice);
    for (let i = 0; i < 400 && refs.some((r) => useStore.getState().catalog.priceState[r]); i++) await new Promise((r) => setTimeout(r, 2));
    expect(peak).toBeLessThanOrEqual(3);
    expect(refs.every((r) => useStore.getState().catalog.models[r].price)).toBe(true);
  });
  it('the estimate uses the loaded price even when the schema holds only the token note', () => {
    setCatalog({ schemas: { [REF]: { ref: REF, params: [], slots: { prompt: 'prompt', promptRequired: true }, price: { skus: [], note: 'Billed by tokens' }, source: 'catalog' } } });
    setCatalog((c) => ({ models: { ...c.models, [REF]: { ...model, price: { skus: [{ unit: 'output', usd: 0.04 }] } } } }));
    expect(estimateMedia(REF, 'image', { ...settings, count: 2 }, false).usd).toBe(0.08);
  });
});
