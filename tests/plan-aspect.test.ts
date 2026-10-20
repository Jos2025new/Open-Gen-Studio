import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { referenceStepIds } from '../src/engine/planAspect';
import { useStore } from '../src/store/store';
import type { ModelSummary, ModelSchema, ImageStep } from '../src/engine/types';

/* ADR 0025 E: the confirmed aspect is the deliverable's; references that wrote their own keep it; one outside image keeps its shape. */
const ref = 'atlas::google/nano-banana-2/text-to-image';
const initial = useStore.getState().catalog;
afterEach(() => useStore.setState({ catalog: initial }));

function context(confirmedAspect = '16:9'): PlanContext {
  const model = { ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name: 'Nano Banana 2', acceptsText: true, acceptsImage: true, tags: [] } as ModelSummary;
  const schema = {
    ref, source: 'catalog',
    params: [{ key: 'aspect_ratio', label: 'Aspect', role: 'aspect', type: 'enum', options: ['1:1', '16:9', '9:16', '2:3', '3:2', '3:4'], default: '1:1' }],
    slots: { prompt: 'prompt', images: { key: 'image_urls', min: 0, max: 4, multiple: true, format: 'url' } },
  } as unknown as ModelSchema;
  useStore.setState({ catalog: { ...initial, models: { [ref]: model }, schemas: { [ref]: schema } } });
  return {
    workspace: 'chat', getModel: async (r) => (r === ref ? { model, schema } : null),
    defaultModel: () => ref, defaultSettings: () => ({ aspect: '1:1' }),
    asset: (id: string) => (id === 'photo' ? { id, kind: 'image', width: 1000, height: 1500 } : undefined) as never,
    layer: () => undefined, variantModel: () => ref,
    confirmed: () => ({ modelRef: ref, needsImage: false, count: 1, aspect: confirmedAspect }),
  } as PlanContext;
}
const aspects = (r: Awaited<ReturnType<typeof normalizePlan>>) => (r.plan?.steps ?? []).map((s) => (s as ImageStep).settings.aspect);
const notes = (r: Awaited<ReturnType<typeof normalizePlan>>) => (r.plan?.adjustments ?? []).join(' | ');

describe('aspect follows the deliverable', () => {
  it('a reference that writes its own aspect keeps it; the scenes that use it take the deliverable\'s', async () => {
    const r = await normalizePlan({ steps: [
      { id: 'char', kind: 'image', aspect: '9:16', prompt: 'Full-body reference of the woman' },
      { id: 'room', kind: 'image', aspect: '16:9', prompt: 'The living room, empty' },
      { id: 'a', kind: 'image', refs: ['char', 'room'], prompt: 'She dances in the room' },
      { id: 'b', kind: 'image', refs: ['char'], prompt: 'She at the door' },
    ] }, context(), 'p');
    expect(r.errors).toEqual([]);
    expect(aspects(r)).toEqual(['9:16', '16:9', '16:9', '16:9']);
    expect(notes(r)).not.toContain('char: aspect');
  });

  it('a reference that writes no aspect gets the confirmed one, as before', async () => {
    const r = await normalizePlan({ steps: [
      { id: 'char', kind: 'image', prompt: 'Full-body reference' },
      { id: 'a', kind: 'image', refs: ['char'], prompt: 'She dances' },
    ] }, context(), 'p');
    expect(aspects(r)).toEqual(['16:9', '16:9']);
  });

  it('a deliverable that writes another aspect is still set to the confirmed one, and it says so', async () => {
    const r = await normalizePlan({ steps: [{ id: 'a', kind: 'image', aspect: '1:1', prompt: 'A poster' }] }, context(), 'p');
    expect(aspects(r)).toEqual(['16:9']);
    expect(notes(r)).toContain('a: aspect 1:1 → 16:9 (confirmed)');
  });

  it('a step made from one outside image keeps that image\'s shape and notes why', async () => {
    const r = await normalizePlan({ steps: [{ id: 'a', kind: 'image', refs: ['asset:photo'], prompt: 'Make her smile' }] }, context(), 'p');
    expect(r.errors).toEqual([]);
    expect(aspects(r)).toEqual(['2:3']);
    expect(notes(r)).toContain('a: aspect 2:3 from the input image, not the confirmed 16:9');
  });

  it('a step with its own aspect keeps being forced even with one outside image', async () => {
    const r = await normalizePlan({ steps: [{ id: 'a', kind: 'image', aspect: '3:4', refs: ['asset:photo'], prompt: 'Make her smile' }] }, context(), 'p');
    expect(aspects(r)).toEqual(['16:9']);
  });

  it('references are the steps others use in refs, as a continuity source or as a subject\'s source', () => {
    const steps = [{ id: 'a', kind: 'image' }, { id: 'b', kind: 'image', refs: ['a#1'] }, { id: 'c', kind: 'image' }, { id: 'd', kind: 'image' }, { id: 'e', kind: 'image' }] as never;
    expect([...referenceStepIds({ continuity: [{ source: 'c', preserve: 'x', steps: ['e'] }], subjects: [{ name: 'Kai', from: 'd' }] }, steps)].sort()).toEqual(['a', 'c', 'd']);
  });
});
