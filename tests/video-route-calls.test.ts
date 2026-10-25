// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', async (orig) => ({ ...(await orig<typeof import('../src/lib/idb')>()), stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import * as params from '../src/engine/params';
import { Composer } from '../src/components/composer/Composer';
import { useStore } from '../src/store/store';
import type { Asset, ModelSchema, ModelSummary } from '../src/engine/types';

const ref = 'atlas::video-route-composer-test';
const model = { ref, provider: 'atlas', id: 'video-route-composer-test', name: 'Video route composer test', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] } as ModelSummary;
const asset = (id: string): Asset => ({ id, kind: 'image', name: id, mime: 'image/png', width: 32, height: 32, sessionId: 'test', origin: 'upload', stored: false, favorite: false, createdAt: 0 });
const schema: ModelSchema = { ref, source: 'catalog', params: [], slots: { prompt: 'prompt', firstFrame: { key: 'first', format: 'url' }, images: { key: 'refs', min: 0, max: 8, multiple: true, format: 'url' }, frameRules: { refsWithFirst: false, refsWithLast: false } } };
const initial = useStore.getState();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.assign(globalThis, { ResizeObserver: class { observe() {} disconnect() {} } });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  useStore.setState(initial);
  vi.restoreAllMocks();
});

it('Composer mention choices and attachment-count route hints use the shared frame routing', async () => {
  const routed = vi.spyOn(params, 'routeVideoInputs');
  const st = useStore.getState();
  useStore.setState({ assets: { one: asset('one'), two: asset('two') }, catalog: { ...st.catalog, models: { ...st.catalog.models, [ref]: model }, schemas: { ...st.catalog.schemas, [ref]: schema } }, composer: { ...st.composer, mode: 'video', text: '', attachments: ['one'], video: { ...st.composer.video, modelRef: ref } }, ui: { ...st.ui, workspace: 'chat' } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(createElement(Composer)); });
  await act(async () => { useStore.setState(s => ({ composer: { ...s.composer, attachments: ['one', 'two'] } })); });
  const relevant = routed.mock.results.filter((_, i) => routed.mock.calls[i]?.[1]?.length);
  expect(routed.mock.calls.some(([, images]) => images?.[0] === 'one')).toBe(true);
  expect(routed.mock.calls.some(([, images]) => images?.[0] === 1)).toBe(true);
  expect(routed.mock.calls.some(([, images]) => images?.[0] === 1 && images?.[1] === 2)).toBe(true);
  expect(relevant.some((call) => call.value.images.length === 1 && call.value.firstFrame === undefined)).toBe(true);
  expect(relevant.some((call) => call.value.images.length === 2 && call.value.firstFrame === undefined)).toBe(true);
  expect(relevant.map((call) => call.value.images)).toContainEqual(['one', 'two']);
});
