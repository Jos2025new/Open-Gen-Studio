import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { ATLAS_QUOTE_URL, atlasQuoteBody, fetchAtlasQuote, knownAtlasQuote, parseAtlasQuote } from '../src/engine/quotes';
import { estimateMedia } from '../src/engine/costs';
import { useStore } from '../src/store/store';
import type { ModelSchema, ModelSummary } from '../src/engine/types';

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
    const body = atlasQuoteBody(model.id, schema, settings);
    expect(body).toEqual({ model: 'alibaba/wan-3.0/text-to-video', resolution: '720p', duration: 5, prompt: 'price quote' });
    expect(await fetchAtlasQuote(body)).toBe(0.4);
    expect(parseAtlasQuote({ data: { price: '0.0585' } })).toBe(0.0585);
    expect(parseAtlasQuote({ data: {} })).toBeNull();
  });

  it('the estimate shows first, then the exact quote replaces it (asked once per distinct request)', async () => {
    const first = estimateMedia(REF, 'video', settings, false);
    expect(first.exact).toBeUndefined();
    expect(first.lowerBound).toBe(true);
    await vi.waitFor(() => expect(knownAtlasQuote(REF, settings)).toBe(0.4));
    expect(estimateMedia(REF, 'video', settings, false)).toMatchObject({ usd: 0.4, exact: true, approximate: false });
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
    await vi.waitFor(() => expect(knownAtlasQuote(REF, two)).toBeCloseTo(0.8));
    expect(estimateMedia(REF, 'video', two, false)).toMatchObject({ exact: true });
    expect(estimateMedia(REF, 'video', two, false).usd).toBeCloseTo(0.8);
    expect(bodies).toHaveLength(1); // the same body for each request: asked once
  });

  it('other providers are not quoted', () => {
    expect(knownAtlasQuote('nanogpt::minimax-h3', settings)).toBeUndefined();
    expect(bodies).toHaveLength(0);
  });
});
