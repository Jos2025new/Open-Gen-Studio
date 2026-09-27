import { describe, expect, it, vi } from 'vitest';
import { opModelForAsset } from '../src/engine/catalog';
import { estimateSpec, opSpec } from '../src/engine/jobs';
import { estimateSteps } from '../src/engine/executor';
import { useStore } from '../src/store/store';
import type { Asset, Generation, ModelSchema, ModelSummary, PlanStep } from '../src/engine/types';

vi.hoisted(() => {
  Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));

const T2I = 'fal::fal-ai/nano-banana-2';
const EDIT2 = 'fal::fal-ai/nano-banana-2/edit';
const PRO = 'fal::fal-ai/nano-banana-pro/edit';
const SEED = 'fal::fal-ai/bytedance/seedream/v4/edit';

function install() {
  const st = useStore.getState();
  const model = (ref: string, usd: number, acceptsImage = true): ModelSummary => ({
    ref, provider: 'fal', id: ref.slice(5), name: ref.slice(5), kind: 'image', acceptsText: true, acceptsImage, tags: [],
    price: { skus: [{ usd, unit: 'output' }] } as ModelSummary['price'],
  });
  const schema = (ref: string, images: boolean): ModelSchema => ({
    ref, params: [], source: 'openapi',
    slots: { prompt: 'prompt', ...(images ? { images: { key: 'image_urls', max: 4, min: 1, multiple: true, format: 'data-url' as const } } : {}) },
  });
  const asset = (id: string, generationId?: string): Asset => ({ id, kind: 'image', mime: 'image/png', width: 1024, height: 1536, sessionId: 's', generationId, origin: generationId ? 'generated' : 'upload', stored: true, favorite: false, createdAt: 0 });
  useStore.setState({
    assets: { made: asset('made', 'g1'), upload: asset('upload') },
    generations: { g1: { id: 'g1', modelRef: T2I } as Generation },
    catalog: {
      ...st.catalog,
      models: { [T2I]: model(T2I, 0.08, false), [EDIT2]: model(EDIT2, 0.08), [PRO]: model(PRO, 0.15), [SEED]: model(SEED, 0.03) },
      schemas: { [T2I]: schema(T2I, false), [EDIT2]: schema(EDIT2, true), [PRO]: schema(PRO, true), [SEED]: schema(SEED, true) },
    },
    composer: { ...st.composer, image: { ...st.composer.image, modelRef: PRO } },
    settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k', atlas: '', nanogpt: '' }, ops: { ...st.settings.ops, edit: null } },
  });
}

describe('operation model follows the source', () => {
  it('uses the edit counterpart of the model that made the image; uploads keep the default', () => {
    install();
    expect(opModelForAsset('edit', 'made').ref).toBe(EDIT2);
    expect(opModelForAsset('edit', 'upload').ref).toBe(PRO);
    // Dedicated engines (upscale, background removal) do not follow the source.
    expect(opModelForAsset('upscale', 'made').ref).not.toBe(EDIT2);
  });

  it('builds, prices and re-prices the run with that model or the one picked for this run', async () => {
    install();
    const spec = await opSpec({ sessionId: 's', sourceAssetId: 'made', op: 'relight', params: { light: 'golden', from: 'left', intensity: 'medium' }, origin: 'op' });
    expect(spec.modelRef).toBe(EDIT2);
    expect(spec.estimate?.usd).toBeCloseTo(0.08);
    const picked = await opSpec({ sessionId: 's', sourceAssetId: 'made', op: 'angle', params: { view: 'front' }, origin: 'op', modelRef: SEED });
    expect(picked.modelRef).toBe(SEED);
    expect(picked.estimate?.usd).toBeCloseTo(0.03);
    // Regenerate re-estimates from the spec's own model, not the engine default.
    expect(estimateSpec({ ...picked, estimate: undefined }).usd).toBeCloseTo(0.03);
  });

  it('plans price an operation on an earlier step with that step’s model', () => {
    install();
    const steps = [
      { id: 's1', kind: 'image', prompt: 'a', modelRef: T2I, settings: { count: 1, advanced: {} }, refs: [] },
      { id: 's2', kind: 'op', op: 'relight', input: 's1', params: {} },
    ] as unknown as PlanStep[];
    expect(estimateSteps(steps).perStep.s2.usd).toBeCloseTo(0.08);
  });

  it('keeps a portrait source portrait: an explicit size, not "auto" (GPT Image chose landscape with auto)', async () => {
    install();
    const size = { key: 'size', label: 'Size', role: 'aspect', type: 'enum', default: '1024x1024', options: ['auto', '1024x1024', '1024x768', '768x1024', '1024x1536', '1536x1024'] } as never;
    const st = useStore.getState();
    useStore.setState({ catalog: { ...st.catalog, schemas: { ...st.catalog.schemas, [EDIT2]: { ...st.catalog.schemas[EDIT2], params: [size] } } } });
    const spec = await opSpec({ sessionId: 's', sourceAssetId: 'made', op: 'angle', params: { view: 'three_quarter_right' }, origin: 'op' });
    expect(spec.settings.aspect).toBe('1024x1536');
    // A model with an explicit "match input" option keeps using it.
    useStore.setState({ catalog: { ...st.catalog, schemas: { ...st.catalog.schemas, [EDIT2]: { ...st.catalog.schemas[EDIT2], params: [{ ...(size as object), options: ['match_input_image', '1:1', '16:9'] } as never] } } } });
    expect((await opSpec({ sessionId: 's', sourceAssetId: 'made', op: 'relight', params: {}, origin: 'op' })).settings.aspect).toBe('match_input_image');
  });
});
