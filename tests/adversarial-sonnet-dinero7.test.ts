// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({ raw: undefined as string | undefined }));
const lock = vi.hoisted(() => ({ held: true }));

vi.mock('../src/lib/writerLock', async (orig) => ({ ...(await orig<typeof import('../src/lib/writerLock')>()), holdsWriterLock: () => lock.held, mayStartWork: () => lock.held }));
vi.mock('../src/lib/idb', async () => {
  const { guard } = await import('../src/lib/saveGuard');
  return {
    stateDb: {
      get: async () => disk.raw,
      set: async (_k: string, raw: string | { text(): string }) => {
        if (guard.discarding) return 'fail';
        if (!lock.held) return 'browser-only';
        disk.raw = typeof raw === 'string' ? raw : raw.text();
        return 'ok';
      },
      del: async () => undefined,
    },
    cacheDb: { get: async () => undefined, set: async () => undefined },
    getAssetBlob: async () => new Blob(['img'], { type: 'image/png' }),
    putAssetBlob: async () => undefined,
    deleteAssetBlobs: async () => undefined,
    peekAssetUrl: () => undefined,
    loadAssetUrl: async () => undefined,
  };
});
vi.mock('../src/lib/media', async (orig) => ({ ...(await orig<typeof import('../src/lib/media')>()), probeMedia: async () => ({ width: 512, height: 512 }) }));
vi.mock('../src/engine/design/raster', () => ({ flushRaster: async () => undefined }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }) }));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { guard } from '../src/lib/saveGuard';
import { useStore } from '../src/store/store';
import { forgetBalances } from '../src/engine/credit';
import { createGeneration, resumeInterrupted, runGeneration } from '../src/engine/jobs';
import { controllers, running } from '../src/engine/jobState';
import { ADAPTERS } from '../src/engine/providers/registry';
import { SessionInfo } from '../src/components/shell/SessionTools';
import { sessionStats } from '../src/components/shell/SessionRow';
import type { ModelSummary } from '../src/engine/types';
import { mainThread } from './helpers/threads';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NANO = 'nanogpt::unpriced';
const FREE = 'nanogpt::free';
const sid = () => useStore.getState().activeSessionId;
const genOf = (id: string) => useStore.getState().generations[id];
const rj = (id: string) => ({ provider: 'nanogpt' as const, id, meta: {} });
const imgOut = (tag: string, costUsd?: number) => ({ outputs: [{ blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png' }], costUsd });

const reloadFromDisk = async () => {
  running.clear();
  controllers.clear();
  useStore.setState({ generations: {}, spentUsd: -1, spendLog: [], assets: {} });
  await useStore.persist.rehydrate();
  await resumeInterrupted();
};

let mountedRoot: Root | null = null;
function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  mountedRoot = createRoot(host);
  act(() => mountedRoot!.render(el));
  return host;
}

beforeEach(() => {
  disk.raw = undefined;
  lock.held = true;
  guard.discarding = false;
  running.clear();
  controllers.clear();
  forgetBalances();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new Error(`Unexpected fetch: ${url}`); }));
  const st = useStore.getState();
  const sId = st.activeSessionId;
  const unpricedModel: ModelSummary = { ref: NANO, provider: 'nanogpt', id: 'unpriced', name: 'Unpriced Model', kind: 'image', acceptsText: true, acceptsImage: false, tags: [] };
  const freeModel: ModelSummary = { ref: FREE, provider: 'nanogpt', id: 'free', name: 'Free Model', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0 }] } };
  const sch = (ref: string) => ({ ref, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' });
  useStore.setState({
    generations: {},
    quotes: {},
    spendLog: [],
    spentUsd: 0,
    assets: {},
    ui: { ...st.ui, toasts: [] },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k-n' }, budgetOn: false, mutedNotices: [] },
    catalog: { ...st.catalog, models: { [NANO]: unpricedModel, [FREE]: freeModel }, schemas: { [NANO]: sch(NANO), [FREE]: sch(FREE) } } as never,
    sessions: { ...st.sessions, [sId]: { ...st.sessions[sId], feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
});

afterEach(() => {
  if (mountedRoot) { act(() => mountedRoot!.unmount()); mountedRoot = null; }
  document.body.innerHTML = '';
  running.clear();
  controllers.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});


describe('Adversarial (Sonnet) dinero 7: mixed unknown + priced batch must not claim an exact cost', () => {
  const runMixed = async (budget?: number) => {
    let n = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async (opts) => {
      if (++n === 1) return imgOut('m1', undefined);
      opts.onRemoteJob?.(rj('jm2'));
      return new Promise(() => undefined);
    });
    if (budget != null) useStore.setState((s) => ({ settings: { ...s.settings, budgetOn: true, budgetUsd: budget }, sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], noAskOverLimit: true } } }));
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'mixed batch', modelRef: NANO, settings: { count: 2, advanced: {} }, inputs: { refs: [] }, estimate: { usd: null, approximate: true } });
    void runGeneration(g.id).catch(() => undefined);
    await vi.waitFor(() => expect(disk.raw ?? '').toContain('"jm2"'));
    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValue(imgOut('m2', 0.3));
    await reloadFromDisk();
    await running.get(g.id);
    return g.id;
  };

  // Finding A (new): ledgerCost.hasUnknown is computed but finish() ignores it, so actualUsd = 0.3 is stored as if exact.
  it('the finished generation does not store 0.30 as its actual cost when one delivery had an unknown price', async () => {
    const id = await runMixed();
    expect(genOf(id).status).toBe('done');
    expect(genOf(id).actualUsd).toBeUndefined();
  });

  it('session stats and session info flag the mixed generation as a lower bound, not an exact $0.30', async () => {
    await runMixed();
    const stats = sessionStats(useStore.getState().assets, useStore.getState().generations).get(sid());
    expect(stats?.spendUnknown).toBe(true);
    mount(createElement(SessionInfo, { onGenerations: () => undefined }));
    act(() => document.querySelector<HTMLElement>('[aria-label="Session info"]')!.click());
    const tiles = [...document.querySelectorAll('.si-tile')].map((el) => el.textContent);
    expect(tiles[0]).toMatch(/≥|unknown/i);
  });

  it('the over-limit notice does not call a partial cost the "real cost" when a delivery was unpriced', async () => {
    const id = await runMixed(0.1);
    const notes = useStore.getState().sessions[sid()].feed.filter((f) => f.type === 'notice' && (f as { overLimitFor?: { gen: string } }).overLimitFor?.gen === id);
    for (const n of notes) expect((n as { text: string }).text).not.toMatch(/real cost/i);
  });
});
