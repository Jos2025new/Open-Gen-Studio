import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPTERS } from '../src/engine/providers/registry';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { useStore } from '../src/store/store';
import type { Asset, ModelSchema, ModelSummary } from '../src/engine/types';

const fakeWindow = vi.hoisted(() => {
  const w = { setTimeout, clearTimeout, addEventListener: () => undefined };
  Object.assign(globalThis, { window: w, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
  return w;
});
const blobs = new Map<string, Blob>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async (id: string) => blobs.get(id),
  putAssetBlob: async (id: string, blob: Blob) => (blobs.set(id, blob), id),
}));

const modelRef = 'atlas::video-frame-test';
const model = { ref: modelRef, provider: 'atlas', id: 'video-frame-test', name: 'Video frame test', kind: 'video', acceptsText: true, acceptsImage: true, acceptsVideo: true, tags: [] } as ModelSummary;
const asset = (id: string, kind: Asset['kind']): Asset => ({ id, kind, mime: kind === 'video' ? 'video/mp4' : 'image/png', width: 64, height: 64, duration: 8, sessionId: 's', origin: 'upload', stored: true, favorite: false, createdAt: 0 }) as Asset;
const schema = (frameRules: NonNullable<ModelSchema['slots']['frameRules']>, source = false): ModelSchema => ({
  ref: modelRef, params: [], source: 'openapi', slots: {
    prompt: 'prompt', lastFrame: { key: 'lastImageUrl', format: 'data-url' },
    ...(source ? { video: { key: 'videoDataUrl', format: 'data-url' as const } } : { images: { key: 'referenceImages', max: 4, min: 0, multiple: true, format: 'data-url' as const } }),
    frameRules,
  },
});
const sent = vi.fn(async () => ({ outputs: [] }));
const sessionId = () => useStore.getState().activeSessionId;

function install(frameRules: NonNullable<ModelSchema['slots']['frameRules']>, source = false) {
  const st = useStore.getState();
  const sid = sessionId();
  for (const id of ['ref', 'subject', 'last', 'clip']) blobs.set(id, new Blob([new Uint8Array(8)], { type: id === 'clip' ? 'video/mp4' : 'image/png' }));
  useStore.setState({
    assets: { ref: asset('ref', 'image'), subject: asset('subject', 'image'), last: asset('last', 'image'), clip: asset('clip', 'video') },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], id: sid } },
    catalog: { ...st.catalog, models: { ...st.catalog.models, [modelRef]: model }, schemas: { ...st.catalog.schemas, [modelRef]: schema(frameRules, source) } },
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'test-key' }, ops: { ...st.settings.ops, videoEdit: modelRef } },
  });
}

beforeEach(() => {
  vi.stubGlobal('location', { href: 'http://localhost/' });
  sent.mockClear();
  vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(sent as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.assign(globalThis, { window: fakeWindow });
});

describe('final video frame validation in the executor', () => {
  it('checks subject references added after initial validation against the last frame', async () => {
    install({ refsWithLast: false });
    const g = createGeneration({ sessionId: sessionId(), kind: 'video', prompt: '@Ana waves', modelRef, settings: { count: 1, advanced: {} }, inputs: {
      refs: ['ref'], lastFrame: 'last', subjects: [{ id: 'ana', name: 'Ana', frontalAssetId: 'subject', refAssetIds: [] } as never],
    }, origin: 'composer' });
    await expect(runGeneration(g.id)).rejects.toThrow(/reference media with a last frame/);
    expect(sent).not.toHaveBeenCalled();
  });

  it('checks a source video operation together with its last frame', async () => {
    install({ sourceWithLast: false }, true);
    const g = createGeneration({ sessionId: sessionId(), kind: 'video', prompt: 'edit clip', modelRef, settings: { count: 1, advanced: {} }, inputs: { refs: [], lastFrame: 'last' },
      op: { id: 'video_edit', sourceAssetId: 'clip', params: {} }, origin: 'op' });
    await expect(runGeneration(g.id)).rejects.toThrow(/source video with a last frame/);
    expect(sent).not.toHaveBeenCalled();
  });

  it('still sends a valid video request', async () => {
    install({ refsWithLast: false });
    const g = createGeneration({ sessionId: sessionId(), kind: 'video', prompt: 'a flower opens', modelRef, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'composer' });
    await runGeneration(g.id);
    expect(sent).toHaveBeenCalledOnce();
  });
});
