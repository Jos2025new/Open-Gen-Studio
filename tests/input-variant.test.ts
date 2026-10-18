import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { inputVariant } from '../src/engine/catalog';
import { buildSettings, type SettingsDeps } from '../src/engine/agent/settingsCard';
import { useStore } from '../src/store/store';
import type { ModelSummary, ModelSchema } from '../src/engine/types';

const initial = useStore.getState();
const mk = (ref: string, kind: 'image' | 'video', acceptsImage: boolean): ModelSummary =>
  ({ ref, id: ref.split('::')[1], provider: 'atlas', kind, name: ref.split('/').slice(-2, -1)[0], acceptsText: true, acceptsImage, tags: [] }) as ModelSummary;
const schema = (ref: string, acceptsImage: boolean, kind: 'image' | 'video'): ModelSchema =>
  ({ ref, source: 'catalog', params: [], slots: { prompt: 'prompt', ...(acceptsImage ? (kind === 'image' ? { images: { key: 'images', min: 1, max: 4, multiple: true, format: 'url' } } : { firstFrame: { key: 'image' } }) : {}) } }) as unknown as ModelSchema;
function load(list: Array<[string, 'image' | 'video', boolean]>) {
  const models = Object.fromEntries(list.map(([r, k, a]) => [r, mk(r, k, a)]));
  const schemas = Object.fromEntries(list.map(([r, k, a]) => [r, schema(r, a, k)]));
  useStore.setState({ catalog: { ...initial.catalog, models, schemas } });
  return { models, schemas };
}
afterEach(() => useStore.setState({ catalog: initial.catalog }));

const t2i = 'atlas::openai/gpt-image-2.5-flare/text-to-image';
const edit = 'atlas::openai/gpt-image-2.5-flare/edit';
const t2v = 'atlas::alibaba/wan-3.0/text-to-video';
const i2v = 'atlas::alibaba/wan-3.0/image-to-video';

describe('inputVariant: the family endpoint for the inputs', () => {
  it('text-to-image with an image resolves to the edit of the same family', () => {
    load([[t2i, 'image', false], [edit, 'image', true]]);
    expect(inputVariant(t2i, 'image')).toEqual({ ref: edit, route: 'edit' });
  });
  it('a family without edit keeps the current behavior (null)', () => {
    load([[t2i, 'image', false]]);
    expect(inputVariant(t2i, 'image')).toBeNull();
  });
  it('a model that already takes images is left alone', () => {
    load([[t2i, 'image', false], [edit, 'image', true]]);
    expect(inputVariant(edit, 'image')).toBeNull();
  });
  it('text-to-video with a first frame resolves to image-to-video', () => {
    load([[t2v, 'video', false], [i2v, 'video', true]]);
    expect(inputVariant(t2v, 'video')).toEqual({ ref: i2v, route: 'image' });
  });
});

describe('the settings card recommends the family variant by itself', () => {
  const deps = (models: Record<string, ModelSummary>, schemas: Record<string, ModelSchema>): SettingsDeps => ({
    getModel: async (r) => (models[r] ? { model: models[r], schema: schemas[r] } : null),
    suggestModel: () => undefined, composerChosen: () => true, routeModel: () => undefined,
    defaultModel: () => t2i, inputVariant: (r, k) => inputVariant(r, k)?.ref,
  });
  it('agent names the composer t2i with an attached image → edit', async () => {
    const { models, schemas } = load([[t2i, 'image', false], [edit, 'image', true]]);
    const r = await buildSettings({ kind: 'image', count: 1, startImage: false, refs: 1, purpose: 'normal', model: t2i } as never, deps(models, schemas));
    expect('recommended' in r && r.recommended.modelRef).toBe(edit);
  });
  it('no edit in the family → the model stays', async () => {
    const { models, schemas } = load([[t2i, 'image', false]]);
    const r = await buildSettings({ kind: 'image', count: 1, startImage: false, refs: 1, purpose: 'normal', model: t2i } as never, deps(models, schemas));
    expect('recommended' in r && r.recommended.modelRef).toBe(t2i);
  });
});
