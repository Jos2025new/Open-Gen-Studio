// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
const runAssetOp = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../src/engine/actions', async (orig) => ({ ...(await orig<typeof import('../src/engine/actions')>()), runAssetOp, opEstimate: async () => ({ estimate: { usd: 0.01 }, modelName: 'test' }) }));
vi.mock('../src/engine/catalog', async (orig) => ({ ...(await orig<typeof import('../src/engine/catalog')>()), ensureSchema: async () => undefined }));
vi.mock('../src/engine/jobs', async (orig) => ({ ...(await orig<typeof import('../src/engine/jobs')>()), runGeneration: vi.fn(async () => []) }));
import { generateDirect } from '../src/engine/actions';
import { ToolsPanel } from '../src/components/space/ToolsPanel';
import { ReuseButton } from '../src/components/assets/ReuseButton';
import { canReuse, reuseGeneration } from '../src/store/reuse';
import { setUi, useStore } from '../src/store/store';
import { opSpec } from '../src/engine/jobs';
import { pickUi } from '../src/store/persistUi';
import type { Asset, Generation } from '../src/engine/types';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const g: Generation = { sessionId: 'hidden', prompt: '', modelName: 'Missing', provider: 'local', origin: 'op', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, assetIds: [], createdAt: 1, estimate: { usd: 0, approximate: false }, id: 'relit', place: 'space-tools', kind: 'image', status: 'done', modelRef: 'missing', parentId: 'parent', op: { id: 'relight', sourceAssetId: 'source', params: { preset: 'neon', direction: 'right', intensity: 'strong', note: 'new light' } } };
afterEach(() => { vi.clearAllMocks(); setUi({ space: undefined }); });
it('Reusar en Tools aplica el seed con el Space ya abierto', async () => {
  useStore.setState((s) => ({ assets: { source: { id: 'source', kind: 'image' } as Asset }, ui: { ...s.ui, space: 'tools', toolOp: 'relight', toolAsset: undefined } }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  act(() => root.render(createElement(ToolsPanel)));
  await act(async () => { await reuseGeneration(g); });
  expect(useStore.getState().ui.toolSeed).toBeUndefined();
  expect(host.querySelector('textarea')?.value).toBe('new light');
  await act(async () => { await new Promise((r) => setTimeout(r, 180)); });
  act(() => host.querySelector<HTMLButtonElement>('.send-btn')!.click());
  expect(runAssetOp).toHaveBeenCalledWith('source', 'relight', g.op!.params, g.id, undefined);
  // A later click on the same result must apply again, without relying on remounting or a different id.
  await act(async () => { await reuseGeneration({ ...g, op: { ...g.op!, params: { ...g.op!.params, note: 'second' } } }); });
  expect(host.querySelector('textarea')?.value).toBe('second');
  act(() => root.unmount()); host.remove();
});
it('invalid destinations have no button; transient seed is never persisted and clears on close', async () => {
  useStore.setState({ assets: {} });
  expect(canReuse(g)).toBe(false);
  expect(canReuse({ ...g, op: undefined, kind: 'text' })).toBe(false);
  const host = document.createElement('div'); const root = createRoot(host);
  act(() => root.render(createElement(ReuseButton, { g })));
  expect(host.textContent).toBe('');
  setUi({ space: 'tools', toolSeed: { generationId: g.id, op: 'relight', assetId: 'source', params: {} } });
  expect(pickUi(useStore.getState().ui)).not.toHaveProperty('toolSeed');
  setUi({ space: 'create' });
  expect(useStore.getState().ui.toolSeed).toBeUndefined();
  expect(canReuse({ ...g, place: 'studio' })).toBe(false);
  act(() => root.unmount());
});
it('Create restores mode and live references, drops obsolete parameters and warns', async () => {
  const st = useStore.getState();
  useStore.setState({ assets: { source: { id: 'source', kind: 'image' } as Asset }, catalog: { ...st.catalog, models: { available: { ref: 'available', kind: 'video', provider: 'local', id: 'available', name: 'Available', acceptsText: true, acceptsImage: true, tags: [] } }, schemas: { available: { ref: 'available', source: 'builtin', params: [{ key: 'quality', role: 'other', type: 'enum', label: 'Quality', options: ['high'] }], slots: {} } } } });
  const create = { ...g, place: 'space-create', op: undefined, kind: 'video', modelRef: 'available', prompt: 'camera moves', settings: { count: 1, advanced: { quality: 'high', obsolete: true } }, inputs: { refs: ['source', 'deleted'], firstFrame: 'source', times: { source: 2, deleted: 3 } } } as Generation;
  await reuseGeneration(create);
  expect(useStore.getState().ui).toMatchObject({ space: 'create', home: false, panel: null });
  expect(useStore.getState().composer).toMatchObject({ mode: 'video', text: 'camera moves', attachments: ['source'], times: { source: 2 }, video: { modelRef: 'available', settings: { advanced: { quality: 'high' } } } });
  expect(useStore.getState().composer.video.settings.advanced).not.toHaveProperty('obsolete');
  expect(useStore.getState().ui.toasts.at(-1)?.text).toContain('obsolete');
  expect(useStore.getState().ui.toasts.at(-1)?.text).toContain('deleted');
});

it('a text transcription reuses its source and its available model for this run only', async () => {
  const st = useStore.getState();
  const ref = 'nanogpt::transcriber';
  useStore.setState({ assets: { audio: { id: 'audio', kind: 'audio', duration: 60 } as Asset },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'test-only' } },
    catalog: { ...st.catalog, transcribers: { [ref]: { ref, provider: 'nanogpt', name: 'Test transcriber', id: 'transcriber', usdPerMinute: 0.01, maxDirectBytes: 1000000, video: false, diarization: false } } } });
  const text = { ...g, kind: 'text', op: { id: 'transcribe', sourceAssetId: 'audio', params: { language: 'es' } }, modelRef: ref } as Generation;
  await reuseGeneration(text);
  expect(useStore.getState().ui.toolSeed).toMatchObject({ assetId: 'audio', modelRef: ref, params: { language: 'es' } });
  const spec = await opSpec({ sessionId: 'hidden', sourceAssetId: 'audio', op: 'transcribe', params: { language: 'es' }, origin: 'op', modelRef: ref });
  expect(spec.modelRef).toBe(ref);
  expect(useStore.getState().settings.ops.transcribe).toBe(st.settings.ops.transcribe);
});

it('Create reuse from Designer keeps the start frame before references and the seed at launch', async () => {
  const st = useStore.getState();
  useStore.setState({ assets: { start: { id: 'start', kind: 'image' } as Asset, reference: { id: 'reference', kind: 'image' } as Asset },
    ui: { ...st.ui, workspace: 'designer', home: true, space: undefined },
    catalog: { ...st.catalog, models: { replay: { ref: 'replay', provider: 'local', id: 'replay', name: 'Replay', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] } }, schemas: { replay: { ref: 'replay', source: 'builtin', params: [{ key: 'seed', label: 'Seed', role: 'seed', type: 'integer' }], slots: { firstFrame: { key: 'start', format: 'url' }, images: { key: 'refs', min: 0, max: 2, multiple: true, format: 'url' } } } } } });
  const video: Generation = { ...g, place: 'space-create', op: undefined, kind: 'video', modelRef: 'replay', prompt: 'move', inputs: { firstFrame: 'start', refs: ['reference'] }, settings: { count: 1, seed: 42, advanced: {} } };
  await reuseGeneration(video);
  expect(useStore.getState().ui).toMatchObject({ space: 'create', workspace: 'chat' });
  expect(useStore.getState().composer.attachments).toEqual(['start', 'reference']);
  await generateDirect('video');
  const launched = Object.values(useStore.getState().generations).find((result) => result.modelRef === 'replay');
  expect(launched?.settings.seed).toBe(42);
  expect(launched?.inputs).toMatchObject({ firstFrame: 'start', refs: ['reference'] });
});

it('fixed Tools replay their original model without changing the Settings model', async () => {
  const st = useStore.getState();
  const original: Generation = { ...g, id: 'upscaled', modelRef: 'local::old-upscaler', prompt: '', op: { id: 'upscale', sourceAssetId: 'source', params: { factor: '2' } } };
  const summary = { provider: 'local' as const, kind: 'image' as const, acceptsText: false, acceptsImage: true, tags: ['upscale'] };
  useStore.setState({ assets: { source: { id: 'source', kind: 'image', width: 64, height: 64 } as Asset }, generations: { [original.id]: original },
    settings: { ...st.settings, ops: { ...st.settings.ops, upscale: 'local::new-upscaler' } },
    catalog: { ...st.catalog, models: { 'local::old-upscaler': { ...summary, id: 'old-upscaler', ref: 'local::old-upscaler', name: 'Old' }, 'local::new-upscaler': { ...summary, id: 'new-upscaler', ref: 'local::new-upscaler', name: 'New' } }, schemas: { 'local::old-upscaler': { ref: 'local::old-upscaler', source: 'builtin', params: [], slots: {} } } } });
  await reuseGeneration(original);
  const seed = useStore.getState().ui.toolSeed!;
  const spec = await opSpec({ sessionId: 'hidden', sourceAssetId: seed.assetId, op: seed.op, params: seed.params, origin: 'op', modelRef: seed.modelRef, parentId: seed.parentId });
  expect(spec.modelRef).toBe('local::old-upscaler');
  expect(spec.prompt).toBe('');
  expect(useStore.getState().settings.ops.upscale).toBe('local::new-upscaler');
});
