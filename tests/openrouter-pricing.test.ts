import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));

const cache = new Map<string, unknown>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: {
    get: async (k: string) => cache.get(k),
    set: async (k: string, v: unknown) => void cache.set(k, v),
  },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { openrouter, parseOrVideoPricing } from '../src/engine/providers/openrouter';
import type { ModelSummary } from '../src/engine/types';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Frozen catalog: one image model whose endpoint answer is set per test. */
const IMAGES = { data: [{ id: 'acme/pic-1', name: 'Acme: Pic 1', architecture: { input_modalities: ['text'], output_modalities: ['image'] }, supported_parameters: {} }] };

function routeFetch(endpoints: () => Promise<Response> | Response) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/images/models')) return json(IMAGES);
    if (url.endsWith('/videos/models')) return json({ data: [] });
    if (url.includes('/images/models/') && url.endsWith('/endpoints')) return endpoints();
    throw new Error(`unexpected ${url}`);
  });
}

async function priceOf(model: ModelSummary) {
  const schema = await openrouter.loadSchema(model, 'k');
  return schema.price!;
}

const imageModel: ModelSummary = { ref: 'openrouter::acme/pic-1', provider: 'openrouter', id: 'acme/pic-1', name: 'Pic 1', kind: 'image', acceptsText: true, acceptsImage: false, tags: [] };

beforeEach(() => {
  cache.clear();
  vi.unstubAllGlobals();
});

describe('OpenRouter image price cache (fix 2)', () => {
  it('does not keep a failed lookup as "token billed": the next load asks again', async () => {
    let calls = 0;
    routeFetch(() => {
      calls++;
      if (calls === 1) return json({ error: 'boom' }, 500);
      return json({ endpoints: [{ pricing: [{ billable: 'image_output', unit: 'image', cost_usd: 0.04 }] }] });
    });
    const first = await priceOf(imageModel);
    expect(first.skus).toEqual([]);
    expect([...cache.keys()].filter((k) => k.startsWith('or:price'))).toEqual([]);
    const second = await priceOf(imageModel);
    expect(second.skus).toEqual([{ unit: 'output', usd: 0.04 }]);
    expect(calls).toBe(2);
  });

  it('caches a valid answer under the versioned key', async () => {
    routeFetch(() => json({ endpoints: [{ pricing: [{ billable: 'image_output', unit: 'image', cost_usd: 0.04 }] }] }));
    await priceOf(imageModel);
    expect([...cache.keys()].filter((k) => k.startsWith('or:price'))).toEqual(['or:price:v2:acme/pic-1']);
  });
});

describe('OpenRouter image price across endpoints (fix 3)', () => {
  it('reads every endpoint and marks a varying price as a lower bound', async () => {
    routeFetch(() =>
      json({
        endpoints: [
          { pricing: [{ billable: 'image_output', unit: 'image', cost_usd: 0.06 }] },
          { pricing: [{ billable: 'image_output', unit: 'image', cost_usd: 0.04 }] },
        ],
      }),
    );
    const price = await priceOf(imageModel);
    expect(price.skus).toEqual([{ unit: 'output', usd: 0.04 }]);
    expect(price.lowerBound).toBe(true);
    expect(price.note).toMatch(/lowest/);
  });

  it('an agreed price across endpoints is exact', async () => {
    routeFetch(() =>
      json({
        endpoints: [
          { pricing: [{ billable: 'image_output', unit: 'image', cost_usd: 0.04 }] },
          { pricing: [{ billable: 'image_output', unit: 'image', cost_usd: 0.04 }] },
        ],
      }),
    );
    const price = await priceOf(imageModel);
    expect(price.lowerBound).toBeUndefined();
    expect(price.skus).toEqual([{ unit: 'output', usd: 0.04 }]);
  });
});

describe('OpenRouter video pricing units (fix 4)', () => {
  it('shows unrecognised rates as a note and never calls the total exact', () => {
    const rule = parseOrVideoPricing({ duration_seconds_with_audio: '0.1', megapixel_seconds: '0.0002', tokens_per_second: '5' });
    expect(rule.skus).toEqual([expect.objectContaining({ unit: 'second', usd: 0.1, audio: true })]);
    expect(rule.approximate).toBe(true);
    expect(rule.note).toMatch(/megapixel seconds/);
    expect(rule.note).toMatch(/tokens per second/);
  });

  it('a token-only video has no sku and says so', () => {
    const rule = parseOrVideoPricing({ tokens_per_second: '5' });
    expect(rule.skus).toEqual([]);
    expect(rule.note).toMatch(/tokens per second/);
  });
});

describe('OpenRouter image price in the listing (fix 1)', () => {
  it('lists the price of an image model whose price is already cached, and none otherwise', async () => {
    routeFetch(() => json({ endpoints: [{ pricing: [{ billable: 'image_output', unit: 'image', cost_usd: 0.04 }] }] }));
    const before = await openrouter.listModels('k');
    expect(before.find((m) => m.id === 'acme/pic-1')?.price).toBeUndefined();
    await priceOf(imageModel);
    const after = await openrouter.listModels('k');
    expect(after.find((m) => m.id === 'acme/pic-1')?.price).toEqual({ skus: [{ unit: 'output', usd: 0.04 }] });
  });
});
