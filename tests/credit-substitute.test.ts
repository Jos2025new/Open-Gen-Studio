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
import { createGeneration, retryGeneration, runGeneration } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import { HttpError } from '../src/lib/http';
import { forgetBalances, onGenerationCredit } from '../src/engine/credit';
import { useAlerts } from '../src/engine/alerts';
import type { ModelSummary } from '../src/engine/types';
import { mainThread } from './helpers/threads';

/* After a 402, a dearer or unpriced substitute still asks before going over the limit; a plan step is never resent outside its plan. */
const NANO = 'nanogpt::seed';
const ATLAS = 'atlas::seed';
const mk = (provider: 'nanogpt' | 'atlas', usd?: number): ModelSummary => ({ ref: `${provider}::seed`, provider, id: 'seed', name: 'seed', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: usd == null ? undefined : { skus: [{ unit: 'output', usd }] } }) as unknown as ModelSummary;
let atlasSends = 0;
const alerts = () => useAlerts.getState().alerts;
const sid = () => useStore.getState().activeSessionId;

function setup(atlasUsd: number | undefined, budget: { on: boolean; usd: number }, mode: 'ask' | 'always' | 'never' = 'ask') {
  const st = useStore.getState();
  const schema = { params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' };
  useStore.setState({
    generations: {}, quotes: {}, assets: {}, spendLog: [], spentUsd: 0,
    settings: { ...st.settings, autoSwitchProvider: mode, keys: { ...st.settings.keys, nanogpt: 'k', atlas: 'k' }, budgetOn: budget.on, budgetUsd: budget.usd, budgetNoAsk: false, budgetAccepted: null },
    catalog: { ...st.catalog, models: { [NANO]: mk('nanogpt', 0.1), [ATLAS]: mk('atlas', atlasUsd) }, schemas: { [NANO]: { ref: NANO, ...schema }, [ATLAS]: { ref: ATLAS, ...schema } } as never },
    sessions: { ...st.sessions, [st.activeSessionId]: { ...st.sessions[st.activeSessionId], noAskOverLimit: false, feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
}

beforeEach(() => {
  atlasSends = 0;
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [] })));
  useAlerts.setState({ alerts: [] });
  forgetBalances();
  vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(5);
  vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient balance', null));
  vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => { atlasSends++; return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.14 }; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const gen = (planId?: string) => createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'a', modelRef: NANO, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, planId });

describe('a substitute after no credit', () => {
  it('a dearer substitute that goes over the limit asks first; Cancel sends nothing, Continue once sends once', async () => {
    setup(0.14, { on: true, usd: 0.12 });
    const g = gen();
    await runGeneration(g.id).catch(() => undefined);
    const offer = alerts().find((a) => a.actions?.some((x) => x.label.includes('Atlas')))!;
    offer.actions!.find((x) => x.label.includes('Atlas'))!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(atlasSends).toBe(0);
    const ask = alerts().find((a) => a.actions?.some((x) => x.label === 'Continue once'))!;
    expect(ask.text).toMatch(/limit/);
    ask.actions!.find((x) => x.label === 'Cancel')!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(atlasSends).toBe(0);
    offer.actions!.find((x) => x.label.includes('Atlas'))!.run();
    await vi.waitFor(() => expect(alerts().some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true));
    alerts().find((a) => a.actions?.some((x) => x.label === 'Continue once'))!.actions!.find((x) => x.label === 'Continue once')!.run();
    await vi.waitFor(() => expect(useStore.getState().generations[g.id].status).toBe('done'));
    expect(atlasSends).toBe(1);
  });

  it('an unpriced substitute with a limit on asks first', async () => {
    setup(undefined, { on: true, usd: 5 });
    const g = gen();
    await runGeneration(g.id).catch(() => undefined);
    const offer = alerts().find((a) => a.actions?.some((x) => x.label.includes('Atlas')))!;
    offer.actions!.find((x) => x.label.includes('Atlas'))!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(atlasSends).toBe(0);
    expect(alerts().some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true);
  });

  it('a dearer substitute within the limit runs on the click', async () => {
    setup(0.14, { on: true, usd: 5 });
    const g = gen();
    await runGeneration(g.id).catch(() => undefined);
    alerts().find((a) => a.actions?.some((x) => x.label.includes('Atlas')))!.actions!.find((x) => x.label.includes('Atlas'))!.run();
    await vi.waitFor(() => expect(useStore.getState().generations[g.id].status).toBe('done'));
    expect(atlasSends).toBe(1);
  });

  it('a plan step is not resent from the alert: the model changes and the plan\u2019s Retry runs it', async () => {
    for (const [usd, label] of [[0.08, 'Yes, this time'], [0.14, 'Atlas']] as const) {
      setup(usd, { on: false, usd: 5 });
      useAlerts.setState({ alerts: [] });
      forgetBalances();
      const g = gen('plan-1');
      const rerun = vi.fn(async () => []);
      const later = vi.fn(async () => []);
      await onGenerationCredit(g.id, rerun, later);
      const a = alerts().find((x) => x.actions?.some((y) => y.label.includes(label)))!;
      a.actions!.find((y) => y.label.includes(label))!.run();
      await new Promise((r) => setTimeout(r, 20));
      expect(later).not.toHaveBeenCalled();
      expect(rerun).not.toHaveBeenCalled();
      expect(useStore.getState().generations[g.id].modelRef).toBe(ATLAS);
      expect(alerts().some((x) => /Retry/.test(x.text))).toBe(true);
    }
  });

  it('an old alert answered after the card was retried sends nothing (the operation is not paid twice)', async () => {
    setup(0.08, { on: false, usd: 5 });
    const g = gen();
    await runGeneration(g.id).catch(() => undefined);
    const offer = alerts().find((a) => a.actions?.some((x) => x.label === 'Yes, this time'))!;
    // The user recharges and presses Retry on the card: a new attempt of the same operation succeeds on NanoGPT.
    vi.mocked(ADAPTERS.nanogpt.generate).mockResolvedValue({ outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.1 } as never);
    await retryGeneration(g.id);
    offer.actions!.find((x) => x.label === 'Yes, this time')!.run();
    await new Promise((r) => setTimeout(r, 30));
    expect(atlasSends).toBe(0);
    expect(alerts().some((a) => /already/.test(a.text))).toBe(true);
  });
});
