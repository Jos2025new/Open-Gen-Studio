import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { useStore } from '../src/store/store';
import type { ModelSummary, ModelSchema, ImageStep } from '../src/engine/types';

const ref = 'atlas::google/nano-banana-2/text-to-image';
const initial = useStore.getState().catalog;
afterEach(() => useStore.setState({ catalog: initial }));

/** A confirmed card for `confirmed` images (none = no card: direct generation) while the composer says 3. */
function context(confirmed?: number): PlanContext {
  const model = { ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name: 'Nano Banana 2', acceptsText: true, acceptsImage: true, tags: [] } as ModelSummary;
  const schema = { ref, source: 'catalog', params: [], slots: { prompt: 'prompt', images: { key: 'image_urls', min: 0, max: 4, multiple: true, format: 'url' } } } as ModelSchema;
  useStore.setState({ catalog: { ...initial, models: { [ref]: model }, schemas: { [ref]: schema } } });
  return {
    workspace: 'chat', getModel: async (r) => (r === ref ? { model, schema } : null),
    defaultModel: () => ref, defaultSettings: () => ({ count: 3 }), asset: () => undefined, layer: () => undefined,
    variantModel: () => ref,
    confirmed: confirmed ? () => ({ modelRef: ref, needsImage: false, count: confirmed }) : undefined,
  } as PlanContext;
}
const counts = (r: Awaited<ReturnType<typeof normalizePlan>>) => (r.plan?.steps ?? []).map((s) => (s as ImageStep).settings.count);

describe('the confirmed count applies to every image step', () => {
  it('a card for 1 image: several steps without a count make 1 each, not the composer\'s 3', async () => {
    const r = await normalizePlan({ steps: [
      { id: 'a', kind: 'image', prompt: 'The kitchen' },
      { id: 'b', kind: 'image', prompt: 'The living room' },
      { id: 'c', kind: 'image', prompt: 'The garden' },
    ] }, context(1), 'p');
    expect(r.errors).toEqual([]);
    expect(counts(r)).toEqual([1, 1, 1]);
  });

  it('a count the agent writes on a step wins over the card', async () => {
    const r = await normalizePlan({ steps: [
      { id: 'a', kind: 'image', prompt: 'The kitchen' },
      { id: 'b', kind: 'image', count: 3, prompt: 'Three takes of her' },
    ] }, context(1), 'p');
    expect(r.errors).toEqual([]);
    expect(counts(r)).toEqual([1, 3]);
  });

  it('a single step keeps following the card (existing rule)', async () => {
    const r = await normalizePlan({ steps: [{ id: 'a', kind: 'image', count: 4, prompt: 'The kitchen' }] }, context(2), 'p');
    expect(counts(r)).toEqual([2]);
    expect(r.plan?.adjustments.join(' ')).toContain('count 4 → 2 (confirmed)');
  });

  it('without a card (direct generation) the composer count applies', async () => {
    const r = await normalizePlan({ steps: [
      { id: 'a', kind: 'image', prompt: 'The kitchen' },
      { id: 'b', kind: 'image', prompt: 'The garden' },
    ] }, context(), 'p');
    expect(counts(r)).toEqual([3, 3]);
  });

  it('variations still fix the count of their step and are checked against the card', async () => {
    const ok = await normalizePlan({ steps: [
      { id: 'a', kind: 'image', prompt: 'The kitchen' },
      { id: 'b', kind: 'image', prompt: 'The garden', variations: ['at dawn', 'at noon'] },
    ] }, context(2), 'p');
    expect(ok.errors).toEqual([]);
    expect(counts(ok)).toEqual([2, 2]);
    const bad = await normalizePlan({ steps: [
      { id: 'a', kind: 'image', prompt: 'The kitchen' },
      { id: 'b', kind: 'image', prompt: 'The garden', variations: ['at dawn', 'at noon', 'at dusk'] },
    ] }, context(2), 'p');
    expect(bad.errors.join(' ')).toContain('3 variations but the user confirmed 2');
  });

  it('a step that builds on candidates is still refused: the candidates end the plan', async () => {
    const r = await normalizePlan({ steps: [
      { id: 'a', kind: 'image', prompt: 'The kitchen' },
      { id: 'b', kind: 'image', refs: ['a'], prompt: 'The kitchen at night' },
    ] }, context(2), 'p');
    expect(r.errors.join(' ')).toContain('makes several images for the user to choose from');
  });
});
