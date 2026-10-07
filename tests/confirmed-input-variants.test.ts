import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { lineRoutes } from '../src/engine/catalog';
import { useStore } from '../src/store/store';
import type { ModelSummary, ModelSchema, ImageStep } from '../src/engine/types';
const text = 'atlas::google/nano-banana-2/text-to-image-developer';
const edit = 'atlas::google/nano-banana-2/edit-developer';
const initial = useStore.getState().catalog;
afterEach(() => useStore.setState({ catalog: initial }));
function context(confirmedRef = edit, needsImage = true): PlanContext {
  const models = Object.fromEntries([text, edit].map(ref => [ref, { ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name: ref === edit ? 'Nano Banana 2 Edit Developer' : 'Nano Banana 2 Text-to-Image Developer', acceptsText: true, acceptsImage: ref === edit, tags: [] } as ModelSummary]));
  const schemas = Object.fromEntries([text, edit].map(ref => [ref, { ref, source: 'derived', params: [], slots: { prompt: 'prompt', ...(ref === edit ? { images: { key: 'image_urls', min: 1, max: 4, multiple: true, format: 'url' } } : {}) } } as ModelSchema]));
  useStore.setState({ catalog: { ...initial, models, schemas } });
  return {
    workspace: 'chat', getModel: async ref => models[ref] ? { model: models[ref], schema: schemas[ref] } : null,
    defaultModel: () => edit, defaultSettings: () => ({}), asset: () => undefined, layer: () => undefined,
    confirmed: () => ({ modelRef: confirmedRef, needsImage, count: 1 }),
    // Mimics the observed fuzzy-name failure: the edit name resolves back to Edit.
    suggestModel: () => edit,
    variantModel: (ref, route) => lineRoutes(ref)[route],
  } as PlanContext;
}
describe('confirmed family follows each step input route', () => {
  it.each([undefined, text])('accepts invented sources and referenced pages even when the agent writes %s', async model => {
    const result = await normalizePlan({ steps: [
      { id: 's1', kind: 'image', model, prompt: 'Invent Mateo' },
      { id: 's2', kind: 'image', model, prompt: 'Invent Rosa' },
      { id: 's3', kind: 'image', refs: ['s1', 's2'], prompt: 'Both in the bakery' },
    ] }, context(), 'p');
    expect(result.errors).toEqual([]);
    expect(result.plan?.steps.map(s => (s as ImageStep).modelRef)).toEqual([text, text, edit]);
    expect((result.plan?.steps[0] as ImageStep).refs).toEqual([]);
  });
  it('does not switch family or provider when no compatible twin exists', async () => {
    const ctx = context();
    const st = useStore.getState();
    useStore.setState({ catalog: { ...st.catalog, models: { [edit]: st.catalog.models[edit] } } });
    const result = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: 'Invent a character' }] }, ctx, 'p');
    expect(result.plan).toBeNull();
    expect(result.errors.join(' ')).toContain('requires an input image');
  });
  it('adapts a text confirmation to referenced steps', async () => {
    const result = await normalizePlan({ steps: [
      { id: 's1', kind: 'image', prompt: 'Invent a product' },
      { id: 's2', kind: 'image', refs: ['s1'], prompt: 'Another view' },
    ] }, context(text, false), 'p');
    expect(result.errors).toEqual([]);
    expect(result.plan?.steps.map(s => (s as ImageStep).modelRef)).toEqual([text, edit]);
  });
});
