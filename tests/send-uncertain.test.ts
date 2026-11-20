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
import { createGeneration, resumeInterrupted } from '../src/engine/jobs';
import { runGeneration } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import { isMuted, setMuted } from '../src/engine/notices';
import type { ModelSummary } from '../src/engine/types';
import { mainThread } from './helpers/threads';

/* A send that left for the provider and got no answer is remembered across a reload: it may have been charged. */
const REF = 'nanogpt::test-image';
const sid = () => useStore.getState().activeSessionId;
const toasts = () => useStore.getState().ui.toasts;

beforeEach(() => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [] })));
  const st = useStore.getState();
  useStore.setState({
    generations: {}, quotes: {}, assets: {}, spendLog: [], spentUsd: 0, ui: { ...st.ui, toasts: [] },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'test-only' }, budgetOn: false, mutedNotices: [], budgetNoAsk: false, budgetAccepted: null },
    catalog: { ...st.catalog, models: { [REF]: { ref: REF, provider: 'nanogpt', id: 'test-image', name: 'Test', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] } } as ModelSummary },
      schemas: { [REF]: { ref: REF, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' } } },
    sessions: { ...st.sessions, [st.activeSessionId]: { ...st.sessions[st.activeSessionId], feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const make = () => createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'a', modelRef: REF, settings: { count: 1, resolution: 'new', advanced: {} }, inputs: { refs: [] } });

describe('a send that may have been charged', () => {
  it('is marked before the request leaves and cleared when the answer comes back', async () => {
    const g = make();
    let during: number | undefined;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => {
      during = useStore.getState().generations[g.id].sending;
      return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.1 };
    });
    await runGeneration(g.id);
    expect(during).toEqual(expect.any(Number));
    expect(useStore.getState().generations[g.id].sending).toBeUndefined();
  });

  it('after a reload in between: the card says it may have been charged, a toast warns once, "Don\u2019t show again" silences it', async () => {
    const g = make();
    useStore.setState((s) => ({ generations: { ...s.generations, [g.id]: { ...s.generations[g.id], status: 'running', sending: 1 } } }));
    await resumeInterrupted();
    const after = useStore.getState().generations[g.id];
    expect(after.status).toBe('error');
    expect(after.error).toMatch(/may have been sent and charged/);
    expect(after.sending).toBeUndefined();
    expect(toasts()[0].text).toMatch(/may have been sent and charged; check the provider/);
    expect(toasts()[0].action?.label).toMatch(/show again/);
    toasts()[0].action!.run();
    expect(isMuted('send-uncertain')).toBe(true);
    useStore.setState((st) => ({ ui: { ...st.ui, toasts: [] } }));
    const h = make();
    useStore.setState((s) => ({ generations: { ...s.generations, [h.id]: { ...s.generations[h.id], status: 'running', sending: 1 } } }));
    await resumeInterrupted();
    expect(toasts()).toHaveLength(0); // silenced; the card still says it
    expect(useStore.getState().generations[h.id].error).toMatch(/may have been sent and charged/);
    setMuted('send-uncertain', false); // Settings → Budget brings it back
    expect(isMuted('send-uncertain')).toBe(false);
  });

  it('a generation that was never sent keeps the plain message and no toast', async () => {
    const g = make();
    useStore.setState((s) => ({ generations: { ...s.generations, [g.id]: { ...s.generations[g.id], status: 'running' } } }));
    await resumeInterrupted();
    expect(useStore.getState().generations[g.id].error).toMatch(/Regenerate to try again/);
    expect(toasts()).toHaveLength(0);
  });

  it('the one register maps the over-limit notice too', () => {
    expect(isMuted('budget')).toBe(false);
    setMuted('budget', true);
    expect(useStore.getState().settings.budgetNoAsk).toBe(true);
    setMuted('budget', false);
    expect(isMuted('budget')).toBe(false);
  });
});
