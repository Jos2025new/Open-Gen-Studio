import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({ raw: undefined as string | undefined }));
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => disk.raw, set: async (_k: string, raw: string | { text(): string }) => { disk.raw = typeof raw === "string" ? raw : raw.text(); }, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob(['test'], { type: 'image/png' }), putAssetBlob: async () => undefined,
}));
vi.mock('../src/lib/media', async (original) => ({ ...await original<typeof import('../src/lib/media')>(),
  probeMedia: async () => ({ width: 1, height: 1 }) }));

import { useStore } from '../src/store/store';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import { RECRAFT_STYLE_REF } from '../src/engine/catalog';
import { mainThread } from './helpers/threads';

/* Routes that send outside the media path also mark the send before it leaves (a reload after it must say "may have been charged"). */
let seen: number | undefined;
beforeEach(() => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [] })));
  const st = useStore.getState();
  useStore.setState({
    generations: {}, assets: { a1: { id: 'a1', kind: 'image', mime: 'image/png', width: 1, height: 1, sessionId: st.activeSessionId, origin: 'upload', stored: true, favorite: false, createdAt: 1 } as never },
    settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' }, budgetOn: false },
    sessions: { ...st.sessions, [st.activeSessionId]: { ...st.sessions[st.activeSessionId], feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('sending marks on the other routes', () => {
  it('Recraft style: marked while the request is out, cleared when it answers', async () => {
    const g = createGeneration({ sessionId: useStore.getState().activeSessionId, origin: 'composer', kind: 'text', prompt: 'style', modelRef: RECRAFT_STYLE_REF, settings: { count: 1, advanced: {} }, inputs: { refs: ['a1'] } });
    vi.spyOn(ADAPTERS.fal, 'createStyle').mockImplementation(async () => { seen = useStore.getState().generations[g.id].sending; return { text: 'sty_1', costUsd: 0.04 } as never; });
    await runGeneration(g.id);
    expect(seen).toEqual(expect.any(Number));
    expect(useStore.getState().generations[g.id].sending).toBeUndefined();
    expect(useStore.getState().generations[g.id].status).toBe('done');
  });

  it('a batch keeps the mark when no remote job is stored for it (a reload then says it may have been charged)', async () => {
    const REF = 'nanogpt::seed';
    const st = useStore.getState();
    useStore.setState({ catalog: { ...st.catalog, models: { [REF]: { ref: REF, provider: 'nanogpt', id: 'seed', name: 'seed', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] } } as never }, schemas: { [REF]: { ref: REF, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' } } as never }, settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' } } });
    const g = createGeneration({ sessionId: st.activeSessionId, origin: 'composer', kind: 'image', prompt: 'a', modelRef: REF, settings: { count: 2, advanced: {} }, inputs: { refs: [] } });
    let during: number | undefined;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async (req) => {
      req.onRemoteJob?.({ provider: 'nanogpt', id: 'j1', meta: {} });
      during = useStore.getState().generations[g.id].sending;
      return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.1 } as never;
    });
    await runGeneration(g.id).catch(() => undefined);
    expect(useStore.getState().generations[g.id].remoteJob).toBeUndefined();
    expect(during).toEqual(expect.any(Number));
  });
});
