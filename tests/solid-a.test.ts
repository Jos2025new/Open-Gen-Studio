import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
vi.mock('../src/engine/jobs', async (orig) => ({ ...(await orig<typeof import('../src/engine/jobs')>()), runGeneration: vi.fn(async () => []) }));
import { checkDirect, generateDirect } from '../src/engine/actions';
import { useStore } from '../src/store/store';
import { routeFits } from '../src/engine/routing';
import type { Asset, ModelSchema, ModelSummary } from '../src/engine/types';

/* Review SOLID (Opus + Neon, 2026-11-20), batch A: one rule per question, asked by the button, the plan and the send. */
const imageRef = 'atlas::solid-a-image';
const imgModel = { ref: imageRef, provider: 'atlas', id: 'solid-a-image', name: 'Solid A image', kind: 'image', acceptsText: true, acceptsImage: true, tags: [] } as ModelSummary;
const imgSchema: ModelSchema = { ref: imageRef, params: [], source: 'catalog', slots: { prompt: 'prompt', images: { key: 'imgs', max: 14, min: 0, multiple: true, format: 'url', total: 15 } } };
const asset = (id: string): Asset => ({ id, kind: 'image', name: id, mime: 'image/png', width: 32, height: 32, sessionId: 'test', origin: 'upload', stored: false, favorite: false, createdAt: 0 });
const initial = useStore.getState();
const ids = Array.from({ length: 13 }, (_, i) => `a${i}`);

beforeEach(() => {
  const st = useStore.getState();
  useStore.setState({
    assets: Object.fromEntries(ids.map((id) => [id, asset(id)])),
    catalog: { ...st.catalog, models: { ...st.catalog.models, [imageRef]: imgModel }, schemas: { ...st.catalog.schemas, [imageRef]: imgSchema } },
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'test-key' } },
  });
});
afterEach(() => useStore.setState(initial));

describe('1. one reference limit', () => {
  it('the composer button counts the per-call total (references + results) like the plan', () => {
    const st = useStore.getState();
    useStore.setState({ composer: { ...st.composer, mode: 'image', text: 'x', attachments: ids, image: { modelRef: imageRef, settings: { count: 3, advanced: {} } } } });
    expect(checkDirect('image')).toMatchObject({ ok: false, reason: expect.stringMatching(/up to 12 images/) });
    useStore.setState({ composer: { ...useStore.getState().composer, image: { modelRef: imageRef, settings: { count: 1, advanced: {} } } } });
    expect(checkDirect('image').ok).toBe(true);
  });
  it('routing reads the same list as the send when a schema has images and typed references', () => {
    const both: ModelSchema = { ...imgSchema, slots: { prompt: 'prompt', images: { key: 'i', max: 3, min: 0, multiple: true, format: 'url' }, mixedRefs: { key: 'm', max: 9, min: 0 } } };
    expect(routeFits({ ...imgModel, acceptsText: true }, both, { mode: 'reference', refs: 5 })).toBe(true);
  });
});

describe('2. the agent picks the image variant with the send rule', () => {
  it('a text-only video model gets its reference twin, the same the send resolves (not its own text model)', async () => {
    const { routeModel } = await import('../src/engine/agent/runtimeShared');
    const { sentModelRef } = await import('../src/engine/catalog');
    const t = 'atlas::acme/vid-1/text-to-video';
    const r = 'atlas::acme/vid-1/reference-to-video';
    const mk = (ref: string, acceptsImage: boolean) => ({ ref, provider: 'atlas', id: ref.split('::')[1], name: ref, kind: 'video', acceptsText: true, acceptsImage, tags: [] }) as ModelSummary;
    const st = useStore.getState();
    useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } }, catalog: { ...st.catalog, models: { ...st.catalog.models, [t]: mk(t, false), [r]: mk(r, true) } } });
    expect(sentModelRef(t, 'video', true)).toBe(r);
    expect(routeModel(t, 'image')).toBe(r);
    expect(routeModel(t, 'reference')).toBe(r);
    expect(routeModel(t, 'text')).toBe(t);
  });
});

describe('3. subjects counted from the list the send uses', () => {
  it('checkDirect reads the library, not the legacy session.subjects', () => {
    const vref = 'atlas::acme/vid-3/with-subjects';
    const v = { ref: vref, provider: 'atlas', id: 'acme/vid-3/with-subjects', name: 'Subjects video', kind: 'video', acceptsText: true, acceptsImage: false, tags: [] } as ModelSummary;
    const vs: ModelSchema = { ref: vref, params: [], source: 'catalog', slots: { prompt: 'prompt', elements: { key: 'elements', max: 1, video: false } as never } };
    const st = useStore.getState();
    const subject = (id: string) => ({ id, name: id, kind: 'character', frontalAssetId: 'a0', refAssetIds: [] }) as never;
    useStore.setState({ library: [subject('Ana'), subject('Leo')], catalog: { ...st.catalog, models: { ...st.catalog.models, [vref]: v }, schemas: { ...st.catalog.schemas, [vref]: vs } },
      composer: { ...st.composer, mode: 'video', text: '@Ana talks to @Leo', attachments: [], video: { modelRef: vref, settings: { count: 1, advanced: {} } } } });
    expect(checkDirect('video')).toMatchObject({ ok: false, reason: expect.stringMatching(/up to 1 subjects/) });
  });
});

describe('4. direct video resolves the model before routing the inputs', () => {
  it('a text-only video model with an image sends the first frame to its image-to-video twin', async () => {
    const t = 'atlas::acme/vid-4/text-to-video';
    const i = 'atlas::acme/vid-4/image-to-video';
    const mk = (ref: string, acceptsImage: boolean) => ({ ref, provider: 'atlas', id: ref.split('::')[1], name: ref, kind: 'video', acceptsText: true, acceptsImage, tags: [] }) as ModelSummary;
    const sch = (ref: string, first: boolean): ModelSchema => ({ ref, params: [], source: 'catalog', slots: { prompt: 'prompt', ...(first ? { firstFrame: { key: 'image', format: 'url' as const } } : {}) } });
    const st = useStore.getState();
    useStore.setState({ catalog: { ...st.catalog, models: { ...st.catalog.models, [t]: mk(t, false), [i]: mk(i, true) }, schemas: { ...st.catalog.schemas, [t]: sch(t, false), [i]: sch(i, true) } },
      composer: { ...st.composer, mode: 'video', text: 'move', attachments: ['a0'], video: { modelRef: t, settings: { count: 1, advanced: {} } } } });
    await generateDirect('video');
    const g = Object.values(useStore.getState().generations).find((x) => x.prompt === 'move');
    expect(g?.modelRef).toBe(i);
    expect(g?.inputs.firstFrame).toBe('a0');
  });
});
