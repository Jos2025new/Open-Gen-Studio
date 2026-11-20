import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { knownQuote } from '../src/engine/quotes';
import { atlas } from '../src/engine/providers/atlas';
import { ADAPTERS } from '../src/engine/providers/registry';
import { estimateMedia } from '../src/engine/costs';
import { useStore } from '../src/store/store';
import type { ModelSchema, ModelSummary } from '../src/engine/types';

const ATLAS_QUOTE_URL = 'https://api.atlascloud.ai/api/v1/model/calculate';
const REF = 'atlas::alibaba/wan-3.0/text-to-video';
const schema: ModelSchema = {
  ref: REF,
  source: 'openapi',
  slots: { prompt: 'prompt' },
  params: [
    { key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: ['480p', '720p', '1080p'], default: '720p' },
    { key: 'duration', label: 'Duration', role: 'duration', type: 'enum', options: [5, 10], default: 5 },
  ],
} as ModelSchema;
const model = { ref: REF, provider: 'atlas', id: 'alibaba/wan-3.0/text-to-video', name: 'Wan 3.0', kind: 'video', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'second', usd: 0.04 }], lowerBound: true } } as ModelSummary;
const settings = { count: 1, resolution: '720p', duration: 5, advanced: {} };

let bodies: Array<Record<string, unknown>> = [];
beforeEach(() => {
  bodies = [];
  const st = useStore.getState();
  useStore.setState({ quotes: {}, catalog: { ...st.catalog, models: { [REF]: model }, schemas: { [REF]: schema } } });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    expect(url).toBe(ATLAS_QUOTE_URL);
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ code: 200, data: { price: 0.4, origin_price: 0.4, discount: 1 } }));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('exact Atlas price (C3)', () => {
  it('asks with the body the request would send (model + parameters + prompt, no media) and reads data.price', async () => {
    expect(await atlas.quote!(model, schema, settings, 1)).toBe(0.4);
    expect(bodies).toEqual([{ model: 'alibaba/wan-3.0/text-to-video', resolution: '720p', duration: 5, prompt: 'price quote' }]);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { price: '0.0585' } })));
    expect(await atlas.quote!(model, schema, settings, 1)).toBe(0.0585);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: {} })));
    expect(await atlas.quote!(model, schema, settings, 1)).toBeNull();
  });

  it('the estimate shows first, then the exact quote replaces it (asked once per distinct request)', async () => {
    const first = estimateMedia(REF, 'video', settings, false);
    expect(first.exact).toBeUndefined();
    expect(first.lowerBound).toBe(true);
    await vi.waitFor(() => expect(knownQuote(REF, settings)).toBe(0.4));
    expect(estimateMedia(REF, 'video', settings, false)).toMatchObject({ usd: 0.4, exact: true, approximate: false, note: 'Exact price from Atlas for this request' });
    expect(bodies).toHaveLength(1);
  });

  it('a failed quote keeps the estimate and is not retried in a loop', async () => {
    vi.stubGlobal('fetch', async () => {
      bodies.push({});
      throw new Error('blocked');
    });
    estimateMedia(REF, 'video', settings, false);
    await vi.waitFor(() => expect(Object.values(useStore.getState().quotes)).toEqual([null]));
    expect(estimateMedia(REF, 'video', settings, false).exact).toBeUndefined();
    expect(bodies).toHaveLength(1);
  });

  it('×2 on a model that makes one image per request: two requests, the quote counted twice (as charged)', async () => {
    const two = { ...settings, count: 2 };
    estimateMedia(REF, 'video', two, false);
    await vi.waitFor(() => expect(knownQuote(REF, two)).toBeCloseTo(0.8));
    expect(estimateMedia(REF, 'video', two, false)).toMatchObject({ exact: true });
    expect(estimateMedia(REF, 'video', two, false).usd).toBeCloseTo(0.8);
    expect(bodies).toHaveLength(1); // the same body for each request: asked once
  });

  it('other providers are not quoted', () => {
    expect(knownQuote('nanogpt::minimax-h3', settings)).toBeUndefined();
    expect(bodies).toHaveLength(0);
  });
});

it('deduplicates quotes from another adapter and uses them in the estimate', async () => {
  const ref = 'nanogpt::quote-test';
  const otherModel: ModelSummary = { ...model, ref, provider: 'nanogpt', id: 'quote-test' };
  useStore.setState((s) => ({ catalog: {
    ...s.catalog, models: { ...s.catalog.models, [ref]: otherModel }, schemas: { ...s.catalog.schemas, [ref]: { ...schema, ref } },
  } }));
  const quote = vi.fn(async () => 0.2);
  const previous = ADAPTERS.nanogpt.quote;
  ADAPTERS.nanogpt.quote = quote;
  try {
    estimateMedia(ref, 'video', settings, false);
    estimateMedia(ref, 'video', settings, false);
    await vi.waitFor(() => expect(knownQuote(ref, settings, false)).toBe(0.2));
    expect(estimateMedia(ref, 'video', settings, false)).toMatchObject({ usd: 0.2, exact: true });
    expect(quote).toHaveBeenCalledTimes(1);
    expect(bodies).toHaveLength(0);
  } finally {
    ADAPTERS.nanogpt.quote = previous;
  }
});
