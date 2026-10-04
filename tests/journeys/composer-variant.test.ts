import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error jsdom is already present in the test runtime; this checkout does not include its type package.
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
}));

const TEXT = 'atlas::journey/studio-1/text-to-video';
const IMAGE = 'atlas::journey/studio-1/image-to-video';
const REFERENCES = 'atlas::journey/studio-1/reference-to-video';
const IMAGE_TEXT = 'atlas::journey/studio-1/text-to-image';
const IMAGE_EDIT = 'atlas::journey/studio-1/edit';
const img = (id: string) => ({ id, sessionId: 'test', kind: 'image', name: id, mime: 'image/png', url: '', createdAt: 1, width: 1, height: 1, size: 1 });
let dom: JSDOM | undefined;
let root: Root | undefined;

async function mountComposer() {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  vi.stubGlobal('fetch', async (url: string) => { throw new Error(`Blocked unapproved request in composer journey: ${url}`); });
  const [{ Composer }, { useStore }, { clearJourneyTrace, lastJourneyTrace }] = await Promise.all([
    import('../../src/components/composer/Composer'), import('../../src/store/store'), import('../../src/lib/journeyTrace'),
  ]);
  clearJourneyTrace();
  const st = useStore.getState();
  const models = {
    [TEXT]: { ref: TEXT, provider: 'atlas', id: 'journey/studio-1/text-to-video', name: 'Studio text', kind: 'video', acceptsText: true, acceptsImage: false, tags: [] },
    [IMAGE]: { ref: IMAGE, provider: 'atlas', id: 'journey/studio-1/image-to-video', name: 'Studio image', kind: 'video', acceptsText: false, acceptsImage: true, tags: [] },
    [REFERENCES]: { ref: REFERENCES, provider: 'atlas', id: 'journey/studio-1/reference-to-video', name: 'Studio references', kind: 'video', acceptsText: false, acceptsImage: true, tags: [] },
    [IMAGE_TEXT]: { ref: IMAGE_TEXT, provider: 'atlas', id: 'journey/studio-1/text-to-image', name: 'Studio image text', kind: 'image', acceptsText: true, acceptsImage: false, tags: [] },
    [IMAGE_EDIT]: { ref: IMAGE_EDIT, provider: 'atlas', id: 'journey/studio-1/edit', name: 'Studio image edit', kind: 'image', acceptsText: true, acceptsImage: true, tags: [] },
  } as never;
  const schemas = {
    [TEXT]: { ref: TEXT, params: [], slots: { prompt: 'prompt', promptRequired: true } },
    [IMAGE]: { ref: IMAGE, params: [], slots: { prompt: 'prompt', firstFrame: { key: 'image_url' } } },
    [REFERENCES]: { ref: REFERENCES, params: [], slots: { prompt: 'prompt', keyframes: { fps: 24, key: 'frames' } } },
    [IMAGE_TEXT]: { ref: IMAGE_TEXT, params: [], slots: { prompt: 'prompt', promptRequired: true } },
    [IMAGE_EDIT]: { ref: IMAGE_EDIT, params: [], slots: { prompt: 'prompt', images: { key: 'image_urls', max: 2, min: 0, multiple: true, format: 'url' } } },
  } as never;
  useStore.setState({
    catalog: { ...st.catalog, models, schemas, status: { ...st.catalog.status, atlas: 'ready' } },
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'test-only' } },
    composer: { ...st.composer, mode: 'video', video: { ...st.composer.video, modelRef: TEXT }, attachments: [], times: {} },
    assets: {},
  });
  const target = dom.window.document.getElementById('root')!;
  root = createRoot(target);
  await act(async () => { root!.render(createElement(Composer)); });
  return { useStore, lastJourneyTrace };
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  dom?.window.close();
  dom = undefined;
  vi.unstubAllGlobals();
});

describe('the Composer React variant effect', () => {
  it('switches text-to-video to keyframes for two attached images and records start/end meaning', async () => {
    const { useStore, lastJourneyTrace } = await mountComposer();
    const st = useStore.getState();
    await act(async () => useStore.setState({ assets: { a: img('a'), b: img('b') } as never, composer: { ...st.composer, attachments: ['a', 'b'] } }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(useStore.getState().composer.video.modelRef).toBe(REFERENCES);
    const switchEvent = lastJourneyTrace().find((e) => e.event === 'composer.variant_switched');
    expect(switchEvent?.after).toMatchObject({ modelRef: REFERENCES, imageCount: 2, inputFunctions: { keyframes: 2, start: 'image 1', end: 'image 2' } });
  });

  it('may retain a same-line image route without enough reference capacity; the real validator blocks sending it', async () => {
    const { useStore, lastJourneyTrace } = await mountComposer();
    const { checkDirect } = await import('../../src/engine/actions');
    const st = useStore.getState();
    const capped = { ...st.catalog.models[IMAGE], ref: IMAGE, id: 'journey/studio-1/image-to-video', acceptsText: false, acceptsImage: true };
    const cappedSchema = { ref: IMAGE, params: [], slots: { prompt: 'prompt', firstFrame: { key: 'image_url' } }, source: 'catalog' } as never;
    await act(async () => useStore.setState((s) => ({ catalog: { ...s.catalog, models: { [TEXT]: s.catalog.models[TEXT], [IMAGE]: capped }, schemas: { [TEXT]: s.catalog.schemas[TEXT], [IMAGE]: cappedSchema } } })));
    await act(async () => useStore.setState((s) => ({ assets: { ...s.assets, a: img('a'), b: img('b') } as never, composer: { ...s.composer, attachments: ['a', 'b'] } })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(useStore.getState().composer.video.modelRef).toBe(IMAGE);
    expect(checkDirect('video')).toMatchObject({ ok: false, reason: expect.stringMatching(/reference|image|input|start frame|take|needs/i) });
    expect(lastJourneyTrace().find((e) => e.event === 'composer.variant_switched')?.after).toMatchObject({ modelRef: IMAGE, imageCount: 2, inputFunctions: { firstFrame: 'image 1', references: ['image 2'] } });
  });

  it('treats image 1→2 as the same nonzero bucket while video 1→2 selects references', async () => {
    const { useStore, lastJourneyTrace } = await mountComposer();
    await act(async () => useStore.setState((s) => ({ composer: { ...s.composer, mode: 'image', image: { ...s.composer.image, modelRef: IMAGE_TEXT } } })));
    await act(async () => useStore.setState((s) => ({ assets: { ...s.assets, a: img('a') } as never, composer: { ...s.composer, attachments: ['a'] } })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(useStore.getState().composer.image.modelRef).toBe(IMAGE_EDIT);
    await act(async () => useStore.setState((s) => ({ assets: { ...s.assets, b: img('b') } as never, composer: { ...s.composer, attachments: ['a', 'b'] } })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(useStore.getState().composer.image.modelRef).toBe(IMAGE_EDIT);
    const retained = lastJourneyTrace().find((e) => e.event === 'composer.variant_retained' && (e.before as { imageCount?: number })?.imageCount === 1 && (e.after as { imageCount?: number })?.imageCount === 2);
    expect(retained).toBeDefined();
    expect(retained?.after).toMatchObject({ inputFunctions: { references: 2 } });
  });
});
