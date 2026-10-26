import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A model that cannot take the images asked is never used as is (user, 2026-10-25: «sugerir otro modelo en vez de
 * proceder con un modelo incompleto o incompatible»). The agent reads how many references an image model takes, the
 * same model at another connected provider is used when it takes them, and otherwise the agent offers models that do.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { betterProvider, fittingModels } from '../src/engine/agent/providerFit';
import { durationOwed, limitsLine } from '../src/engine/agent/modelLimits';
import { imagesFit } from '../src/engine/agent/settingsParts';
import { useStore } from '../src/store/store';
import type { ModelSchema, ModelSummary } from '../src/engine/types';

const FAL = 'fal::fal-ai/bytedance/seedream/v5/edit';
const OR = 'openrouter::bytedance-seed/seedream-5';
const PRO = 'openrouter::google/gemini-3-pro-image';
const ONE = 'openrouter::qwen/qwen-image';
const before = useStore.getState();
afterEach(() => useStore.setState(before));

const image = (ref: string, provider: string, name: string, max: number): [ModelSummary, ModelSchema] => [
  { ref, id: ref.split('::')[1], provider, kind: 'image', name, acceptsText: true, acceptsImage: true, tags: [] } as unknown as ModelSummary,
  { ref, source: 'catalog', slots: { prompt: 'prompt', images: { key: 'image_urls', max, min: 0, multiple: max > 1, format: 'url' } }, params: [] } as unknown as ModelSchema,
];

function load(list: Array<[ModelSummary, ModelSchema]>) {
  const s = useStore.getState();
  useStore.setState({
    settings: { ...s.settings, keys: { ...s.settings.keys, fal: 'k', openrouter: 'k' } },
    catalog: { ...s.catalog, status: { ...s.catalog.status, fal: 'ready', openrouter: 'ready' }, models: { ...s.catalog.models, ...Object.fromEntries(list.map(([m]) => [m.ref, m])) }, schemas: { ...s.catalog.schemas, ...Object.fromEntries(list.map(([m, sc]) => [m.ref, sc])) } },
  });
}

beforeEach(() => load([image(FAL, 'fal', 'Seedream 5', 2), image(OR, 'openrouter', 'Seedream 5', 10), image(PRO, 'openrouter', 'Nano Banana Pro', 14), image(ONE, 'openrouter', 'Qwen Image', 1)]));

const four = { startImage: false, images: 4 };

describe('images a model cannot take', () => {
  it('the agent reads how many references an image model takes', () => {
    expect(limitsLine(FAL)).toContain('up to 2 reference images');
  });
  it('the same image model at another connected provider takes them: the app uses it', async () => {
    expect((await betterProvider(FAL, four, 'cuatro viñetas con seedream'))?.ref).toBe(OR);
  });
  it('other models that take them all, never the same line or one that takes fewer', async () => {
    const got = await fittingModels(FAL, four);
    expect(got).toContain(PRO);
    expect(got).not.toContain(OR);
    expect(got).not.toContain(ONE);
  });
  it('no plan with a model that drops images: the agent must ask, and the question is owed', async () => {
    const line = await imagesFit(FAL, [{ kind: 'image', refs: 4 }]);
    expect(line).toContain('Do not plan yet');
    expect(line).toContain(PRO);
    expect(line).not.toContain('plan only what it takes');
    expect(durationOwed([{ role: 'tool', content: line }])).toBe(true);
  });
  it('when they fit, nothing to ask', async () => {
    expect(await imagesFit(OR, [{ kind: 'image', refs: 4 }])).toContain('fit');
  });
});
