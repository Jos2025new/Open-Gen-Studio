import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { estimateSteps } from '../src/engine/executor';
import { useStore } from '../src/store/store';
import type { ModelSummary, PlanStep } from '../src/engine/types';

// B10: the plan prices the model the step is sent to; jobs.ts swaps a text-only model to its image twin when inputs are attached.
const initial = useStore.getState();
const T2I = 'atlas::b10/fam/text-to-image';
const EDIT = 'atlas::b10/fam/edit';
const T2V = 'atlas::b10/vid/text-to-video';
const I2V = 'atlas::b10/vid/image-to-video';
const mk = (ref: string, kind: 'image' | 'video', acceptsImage: boolean, usd: number): ModelSummary =>
  ({ ref, id: ref.split('::')[1], provider: 'atlas', kind, name: ref, acceptsText: true, acceptsImage, tags: [], price: { skus: [{ unit: kind === 'video' ? 'second' : 'output', usd }] } }) as ModelSummary;
afterEach(() => useStore.setState({ catalog: initial.catalog }));
function load() {
  const models = { [T2I]: mk(T2I, 'image', false, 0.2), [EDIT]: mk(EDIT, 'image', true, 1.2), [T2V]: mk(T2V, 'video', false, 0.1), [I2V]: mk(I2V, 'video', true, 0.5) };
  useStore.setState({ catalog: { ...initial.catalog, models, schemas: {} } });
}

describe('plan price uses the model that will be sent', () => {
  it('an image step with a reference on a text-only model is priced as its edit twin', () => {
    load();
    const step = { id: 's1', kind: 'image', prompt: 'mug', modelRef: T2I, refs: [{ type: 'asset', id: 'a' }], settings: { count: 1, advanced: {} }, deps: [] } as unknown as PlanStep;
    expect(estimateSteps([step]).perStep.s1.usd).toBeCloseTo(1.2);
  });
  it('without a reference the text-only price stays', () => {
    load();
    const step = { id: 's1', kind: 'image', prompt: 'mug', modelRef: T2I, refs: [], settings: { count: 1, advanced: {} }, deps: [] } as unknown as PlanStep;
    expect(estimateSteps([step]).perStep.s1.usd).toBeCloseTo(0.2);
  });
  it('a video step with references (no first frame) is priced as image-to-video, as jobs.ts sends it', () => {
    load();
    const step = { id: 'v1', kind: 'video', prompt: 'walk', modelRef: T2V, refs: [{ type: 'asset', id: 'a' }], settings: { count: 1, duration: 5, advanced: {} }, deps: [] } as unknown as PlanStep;
    expect(estimateSteps([step]).perStep.v1.usd).toBeCloseTo(2.5);
  });
});
