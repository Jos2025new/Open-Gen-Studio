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
import { createGeneration, runGeneration, isRunning } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import { HttpError } from '../src/lib/http';
import { forgetBalances } from '../src/engine/credit';
import { useAlerts } from '../src/engine/alerts';
import type { ModelSummary } from '../src/engine/types';
import { mainThread } from './helpers/threads';

/* The answer to "Run it on another provider?" re-sends through runGeneration: two clicks cannot pay twice. */
const NANO = 'nanogpt::seed';
const ATLAS = 'atlas::seed';
const mk = (provider: 'nanogpt' | 'atlas', usd: number): ModelSummary => ({ ref: `${provider}::seed`, provider, id: 'seed', name: 'seed', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd }] } }) as unknown as ModelSummary;
let atlasSends = 0;
let release: () => void;

beforeEach(() => {
  atlasSends = 0;
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [] })));
  const st = useStore.getState();
  const schema = { params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' };
  useStore.setState({
    generations: {}, quotes: {}, assets: {}, spendLog: [], spentUsd: 0,
    settings: { ...st.settings, autoSwitchProvider: 'ask', keys: { ...st.settings.keys, nanogpt: 'k', atlas: 'k' }, budgetOn: false },
    catalog: { ...st.catalog, models: { [NANO]: mk('nanogpt', 0.1), [ATLAS]: mk('atlas', 0.08) }, schemas: { [NANO]: { ref: NANO, ...schema }, [ATLAS]: { ref: ATLAS, ...schema } } as never },
    sessions: { ...st.sessions, [st.activeSessionId]: { ...st.sessions[st.activeSessionId], feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
  useAlerts.setState({ alerts: [] });
  forgetBalances();
  vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(5);
  const gate = new Promise<void>((r) => { release = r; });
  vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient balance', null));
  vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => { atlasSends++; await gate; return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.08 }; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('answering the provider question', () => {
  it('two answers while the resend runs send once, and the resend is a running generation', async () => {
    const g = createGeneration({ sessionId: useStore.getState().activeSessionId, origin: 'composer', kind: 'image', prompt: 'a', modelRef: NANO, settings: { count: 1, advanced: {} }, inputs: { refs: [] } });
    await runGeneration(g.id).catch(() => undefined);
    const alert = useAlerts.getState().alerts[0];
    expect(alert?.actions?.[0].label).toBe('Yes, this time');
    alert.actions![0].run();
    alert.actions![0].run();
    await vi.waitFor(() => expect(atlasSends).toBeGreaterThan(0));
    expect(isRunning(g.id)).toBe(true);
    release();
    await vi.waitFor(() => expect(useStore.getState().generations[g.id].status).toBe('done'));
    expect(atlasSends).toBe(1);
  });
});
