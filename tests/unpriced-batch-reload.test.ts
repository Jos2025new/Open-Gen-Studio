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
import { saveNow, useStore } from '../src/store/store';
import { forgetBalances } from '../src/engine/credit';
import { createGeneration, resumeInterrupted, runGeneration } from '../src/engine/jobs';
import { controllers, running } from '../src/engine/jobState';
import { ADAPTERS } from '../src/engine/providers/registry';
import { periodStart, summarizeSpend } from '../src/engine/spending';
import { SpendingPanel } from '../src/components/shell/SpendingPanel';
import { SessionInfo } from '../src/components/shell/SessionTools';
import { sessionStats } from '../src/components/shell/SessionRow';
import type { Generation, ModelSummary } from '../src/engine/types';
import { mainThread } from './helpers/threads';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NANO = 'nanogpt::unpriced';
const FREE = 'nanogpt::free';
const sid = () => useStore.getState().activeSessionId;
const genOf = (id: string) => useStore.getState().generations[id];
const rj = (id: string) => ({ provider: 'nanogpt' as const, id, meta: {} });
const imgOut = (tag: string, costUsd?: number) => ({ outputs: [{ blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png' }], costUsd });
const patchG = (id: string, patch: Partial<Generation>) => useStore.setState((s) => ({ generations: { ...s.generations, [id]: { ...s.generations[id], ...patch } } }));

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

describe('Unpriced batch reloaded mid-flight never counts as confirmed $0', () => {
  it('batch of 2 with estimate.usd = null and no provider costUsd reloaded mid-flight: neither bookedUsd nor session spend is confirmed $0', async () => {
    let n = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async (opts) => {
      if (++n === 1) return imgOut('a1', undefined);
      opts.onRemoteJob?.(rj('j2'));
      return new Promise(() => undefined);
    });
    const g = createGeneration({
      sessionId: sid(),
      origin: 'composer',
      kind: 'image',
      prompt: 'unpriced batch',
      modelRef: NANO,
      settings: { count: 2, advanced: {} },
      inputs: { refs: [] },
      estimate: { usd: null, approximate: true },
    });

    void runGeneration(g.id).catch(() => undefined);
    await vi.waitFor(() => expect(disk.raw ?? '').toContain('"j2"'));

    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValue(imgOut('a2', undefined));
    await reloadFromDisk();
    await running.get(g.id);
    // Second reload verifies idempotency (no duplicate unknown-price entries).
    await reloadFromDisk();

    const finalGen = genOf(g.id);
    expect(finalGen.status).toBe('done');
    expect(finalGen.assetIds).toHaveLength(2);
    expect(finalGen.actualUsd).toBeUndefined();

    // Send ledger records must never have bookedUsd: 0 or costUsd: 0.
    expect(finalGen.sends).toHaveLength(2);
    for (const s of finalGen.sends!) {
      expect(s.status).toBe('done');
      expect(s.costUsd).toBeUndefined();
      expect(s.bookedUsd).toBeUndefined();
      expect(s.estimated).toBe(true);
    }

    // Spend log tracks both unknown-price deliveries without counting them as confirmed $0.
    const log = useStore.getState().spendLog;
    expect(log).toHaveLength(2);
    expect(log.every((e) => e.unknownPrice === true && e.estimated === true)).toBe(true);

    const sessionSpend = summarizeSpend(log.filter((e) => e.sessionId === sid()), 0);
    expect(sessionSpend.count).toBe(2);
    expect(sessionSpend.unknownCount).toBe(2);
    expect(sessionSpend.unknownMedia).toBe(2);

    // Session info UI shows unknown price, never confirmed $0 for Spent/Media.
    mount(createElement(SessionInfo, { onGenerations: () => undefined }));
    const infoBtn = document.querySelector<HTMLElement>('[aria-label="Session info"]')!;
    act(() => infoBtn.click());
    const tiles = [...document.querySelectorAll('.si-tile')].map((el) => el.textContent);
    expect(tiles[0]).toMatch(/Spent.*unknown/i);
    expect(tiles[0]).not.toBe('Spent$0');
    expect(tiles[2]).toMatch(/Media.*unknown/i);
    expect(tiles[2]).not.toBe('Media$0');

    // Spending panel UI shows unknown price for counter and totals, never confirmed $0.00.
    const panelHost = mount(createElement(SpendingPanel));
    expect(panelHost.textContent).toMatch(/price unknown/i);
    expect(panelHost.textContent).toContain('2 charges');
    expect(panelHost.querySelector('.spend-limit')?.textContent).not.toContain('$0 spent');

    // Session row stats also flag spendUnknown rather than confirmed $0.
    const stats = sessionStats(useStore.getState().assets, useStore.getState().generations).get(sid());
    expect(stats?.spendUnknown).toBe(true);
  });

  it('incomplete reloaded batch (2 of 3) with estimate.usd = null and no costUsd records both as unknown price (never $0)', async () => {
    let n = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async (opts) => {
      if (++n === 1) return imgOut('a1', undefined);
      opts.onRemoteJob?.(rj('j2'));
      return new Promise(() => undefined);
    });
    const g = createGeneration({
      sessionId: sid(),
      origin: 'composer',
      kind: 'image',
      prompt: 'unpriced partial',
      modelRef: NANO,
      settings: { count: 3, advanced: {} },
      inputs: { refs: [] },
      estimate: { usd: null, approximate: true },
    });

    void runGeneration(g.id).catch(() => undefined);
    await vi.waitFor(() => expect(disk.raw ?? '').toContain('"j2"'));

    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValue(imgOut('a2', undefined));
    await reloadFromDisk();
    await running.get(g.id);
    await reloadFromDisk();

    const finalGen = genOf(g.id);
    expect(finalGen.status).toBe('error');
    expect(finalGen.assetIds).toHaveLength(2);
    expect(finalGen.sends?.filter((s) => s.status === 'done')).toHaveLength(2);
    for (const s of finalGen.sends!.filter((s) => s.status === 'done')) {
      expect(s.bookedUsd).toBeUndefined();
      expect(s.costUsd).toBeUndefined();
    }
    expect(useStore.getState().spendLog).toHaveLength(2);
    expect(useStore.getState().spendLog.every((e) => e.unknownPrice === true)).toBe(true);
  });

  it('legacy non-ledger reloaded batch without price also records unknown price instead of $0', async () => {
    const g = createGeneration({
      sessionId: sid(),
      origin: 'composer',
      kind: 'image',
      prompt: 'legacy unpriced',
      modelRef: NANO,
      settings: { count: 2, advanced: {} },
      inputs: { refs: [] },
      estimate: { usd: null, approximate: true },
    });
    patchG(g.id, { status: 'running', remoteJob: rj('j_leg'), sends: undefined });
    await saveNow();

    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValueOnce(imgOut('l1', undefined));
    await reloadFromDisk();
    await running.get(g.id);
    await reloadFromDisk();

    expect(genOf(g.id).status).toBe('error');
    expect(useStore.getState().spendLog).toHaveLength(1);
    expect(useStore.getState().spendLog[0].unknownPrice).toBe(true);

    // Complete legacy non-ledger generation (count: 1) also records exactly 1 unknown entry across reloads.
    const gDone = createGeneration({
      sessionId: sid(),
      origin: 'composer',
      kind: 'image',
      prompt: 'legacy unpriced single',
      modelRef: NANO,
      settings: { count: 1, advanced: {} },
      inputs: { refs: [] },
      estimate: { usd: null, approximate: true },
    });
    patchG(gDone.id, { status: 'running', remoteJob: rj('j_leg_done'), sends: undefined });
    await saveNow();

    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValueOnce(imgOut('l2', undefined));
    await reloadFromDisk();
    await running.get(gDone.id);
    await reloadFromDisk();

    expect(genOf(gDone.id).status).toBe('done');
    expect(useStore.getState().spendLog).toHaveLength(2);
    expect(useStore.getState().spendLog.every((e) => e.unknownPrice === true)).toBe(true);
  });

  it('mixed batch (item 1 unknown price + item 2 reports $0.30 after reload) shows lower bound >= $0.30', async () => {
    let n = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async (opts) => {
      if (++n === 1) return imgOut('m1', undefined);
      opts.onRemoteJob?.(rj('jm2'));
      return new Promise(() => undefined);
    });
    const g = createGeneration({
      sessionId: sid(),
      origin: 'composer',
      kind: 'image',
      prompt: 'mixed batch',
      modelRef: NANO,
      settings: { count: 2, advanced: {} },
      inputs: { refs: [] },
      estimate: { usd: null, approximate: true },
    });

    void runGeneration(g.id).catch(() => undefined);
    await vi.waitFor(() => expect(disk.raw ?? '').toContain('"jm2"'));

    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValue(imgOut('m2', 0.3));
    await reloadFromDisk();
    await running.get(g.id);

    expect(useStore.getState().spentUsd).toBeCloseTo(0.3);
    const sends = genOf(g.id).sends!;
    expect(sends[0].bookedUsd).toBeUndefined();
    expect(sends[1].bookedUsd).toBeCloseTo(0.3);

    const sum = summarizeSpend(useStore.getState().spendLog, periodStart('today'));
    expect(sum.total).toBeCloseTo(0.3);
    expect(sum.count).toBe(2);
    expect(sum.unknownCount).toBe(1);

    const panelHost = mount(createElement(SpendingPanel));
    expect(panelHost.textContent).toContain('≥$0.30');

    expect(genOf(g.id).actualUsd).toBeUndefined();
    expect(genOf(g.id).providerReportedUsd).toBeUndefined();
    const stats = sessionStats(useStore.getState().assets, useStore.getState().generations).get(sid());
    expect(stats?.spend).toBeCloseTo(0.3);
    expect(stats?.spendUnknown).toBe(true);

    mount(createElement(SessionInfo, { onGenerations: () => undefined }));
    act(() => document.querySelector<HTMLElement>('[aria-label="Session info"]')!.click());
    expect(document.querySelector('.si-gen small')?.textContent).toContain('≥$0.3');
  });

  it('genuinely free ($0) generation still logs nothing and shows $0 (not unknown price)', async () => {
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockResolvedValue(imgOut('f1', undefined));
    const g = createGeneration({
      sessionId: sid(),
      origin: 'composer',
      kind: 'image',
      prompt: 'free run',
      modelRef: FREE,
      settings: { count: 1, advanced: {} },
      inputs: { refs: [] },
      estimate: { usd: 0, approximate: false },
    });
    await runGeneration(g.id);

    expect(genOf(g.id).status).toBe('done');
    expect(useStore.getState().spendLog).toHaveLength(0);
    const sum = summarizeSpend(useStore.getState().spendLog, 0);
    expect(sum.unknownCount).toBe(0);
  });
});
