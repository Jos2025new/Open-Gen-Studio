// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
vi.mock('../src/engine/quotes', () => ({ atlasQuoteBody: () => ({}), fetchAtlasQuote: async () => null }));
const ctl = vi.hoisted(() => ({ calls: [] as Array<{ count: number; seed?: number; prompt: string }>, failAt: 0 }));
vi.mock('../src/engine/providers/registry', async (orig) => {
  const real = await orig<typeof import('../src/engine/providers/registry')>();
  return { ...real, ADAPTERS: { ...real.ADAPTERS, atlas: { ...real.ADAPTERS.atlas,
    loadSchema: async (m: { ref: string }) => ({ ref: m.ref, params: [], slots: { prompt: 'prompt' }, source: 'openapi' }),
    generate: async (req: { count: number; settings: { seed?: number }; prompt: string }) => {
      ctl.calls.push({ count: req.count, seed: req.settings.seed, prompt: req.prompt });
      if (ctl.calls.length === ctl.failAt) throw new Error('mock second request failed');
      return { outputs: Array.from({ length: req.count }, (_, i) => ({ blob: new Blob([`${ctl.calls.length}-${i}`], { type: 'image/png' }), mime: 'image/png' })) };
    },
  } } };
});

import { createGeneration, retryGeneration, runGeneration } from '../src/engine/jobs';
import { partialRetryCharge, planRetryEstimate } from '../src/engine/retryPartial';
import { useStore } from '../src/store/store';
import type { Generation, ModelSummary, PlanFeedItem, PlanStep } from '../src/engine/types';

const REF = 'atlas::test/image';
const model = { id: 'test/image', ref: REF, name: 'Test image', provider: 'atlas', kind: 'image', acceptsText: true, tags: [] } as unknown as ModelSummary;
beforeEach(() => {
  ctl.calls = []; ctl.failAt = 2;
  const st = useStore.getState();
  useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'mock' } }, catalog: { ...st.catalog, models: { [REF]: model }, schemas: {} }, assets: {}, generations: {} });
});
afterEach(() => vi.restoreAllMocks());

describe('retrying a partial multi-output generation', () => {
  it('sends only missing outputs, preserves delivered assets, and advances the seed', async () => {
    const first = createGeneration({ sessionId: useStore.getState().activeSessionId, kind: 'image', prompt: 'cat', modelRef: REF, settings: { count: 2, seed: 40, advanced: {} }, estimate: { usd: 0.02, approximate: true }, origin: 'composer' });
    await expect(runGeneration(first.id)).rejects.toThrow('mock second request failed');
    const partial = useStore.getState().generations[first.id];
    expect(partial.assetIds).toHaveLength(1);
    const priorAsset = partial.assetIds[0];
    expect(partialRetryCharge({ ...partial, assetIds: [priorAsset, 'new'] }, partial)).toBe(0.01);
    expect(planRetryEstimate([{ id: 's1' } as PlanStep], { s1: { usd: 0.02, approximate: true } }, { stepStates: { s1: 'error' }, stepGenerations: { s1: first.id } } as unknown as PlanFeedItem, { [first.id]: partial } as Record<string, Generation>).usd).toBe(0.01);
    ctl.failAt = 0;
    const retries = [retryGeneration(first.id), retryGeneration(first.id)];
    const retry = Object.values(useStore.getState().generations).find((g) => g.parentId === first.id)!;
    expect(retry.assetIds).toContain(priorAsset); // The relinked card keeps its first result while the retry runs.
    await Promise.all(retries);
    expect(ctl.calls.map((x) => x.count)).toEqual([1, 1, 1]);
    expect(ctl.calls.map((x) => x.seed)).toEqual([40, 41, 42]);
    expect(retry.assetIds).toContain(priorAsset);
    expect(retry.estimate.usd).toBe(0.01);
    expect(useStore.getState().assets[priorAsset]).toBeDefined();
  });

  it('keeps only unfulfilled variations on retry and preserves their prompt and seed', async () => {
    const first = createGeneration({ sessionId: useStore.getState().activeSessionId, kind: 'image', prompt: 'cat', modelRef: REF, settings: { count: 1, seed: 90, advanced: {} }, variants: ['rainy', 'sunny'], estimate: { usd: 0.04, approximate: true }, origin: 'agent' });
    await expect(runGeneration(first.id)).rejects.toThrow('mock second request failed');
    const pendingPrompt = ctl.calls[1].prompt;
    ctl.failAt = 0;
    await retryGeneration(first.id);
    expect(ctl.calls).toHaveLength(3);
    expect(ctl.calls[2].prompt).toBe(pendingPrompt);
    expect(ctl.calls.map((x) => x.seed)).toEqual([90, 91, 92]);
    const retry = Object.values(useStore.getState().generations).find((g) => g.parentId === first.id)!;
    expect(retry.variants).toEqual([]);
    expect(retry.assetIds).toHaveLength(2);
    expect(retry.estimate.usd).toBe(0.02);
  });
});
