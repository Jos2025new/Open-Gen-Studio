import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { inheritDirectModels } from '../src/engine/agent/inherit';
import { useStore } from '../src/store/store';
import type { ModelSummary } from '../src/engine/types';

const initial = useStore.getState();
const nano = 'atlas::google/nano-banana-2/text-to-image';
const other = 'atlas::openai/gpt-image-2.5-flare/text-to-image';
const mk = (ref: string, name: string) => ({ ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name, acceptsText: true, acceptsImage: false, tags: [] }) as ModelSummary;
afterEach(() => useStore.setState({ catalog: initial.catalog, composer: initial.composer }));

describe('Direct inherits what the user names', () => {
  const setup = () => {
    useStore.setState({ catalog: { ...initial.catalog, models: { [nano]: mk(nano, 'Nano Banana 2'), [other]: mk(other, 'GPT Image 2.5 Flare') } }, composer: { ...initial.composer, image: { ...initial.composer.image, modelRef: other } } });
  };
  it('a model the user named becomes the composer pick', () => {
    setup();
    inheritDirectModels([{ kind: 'image', modelRef: nano }], 'hazlo con nano banana');
    expect(useStore.getState().composer.image.modelRef).toBe(nano);
    expect(useStore.getState().composer.userPicked?.image).toBe(true);
  });
  it('a model only the plan names is not inherited', () => {
    setup();
    inheritDirectModels([{ kind: 'image', modelRef: nano }], 'una casa roja');
    expect(useStore.getState().composer.image.modelRef).toBe(other);
  });
});
