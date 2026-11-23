// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({
  raw: undefined as string | undefined,
  failSet: false,
  onSet: undefined as (() => Promise<void> | void) | undefined,
}));
const lock = vi.hoisted(() => ({ held: true }));

vi.mock('../src/lib/writerLock', async (orig) => ({
  ...(await orig<typeof import('../src/lib/writerLock')>()),
  holdsWriterLock: () => lock.held,
  mayStartWork: () => lock.held,
}));
vi.mock('../src/lib/idb', async () => {
  const { guard } = await import('../src/lib/saveGuard');
  return {
    stateDb: {
      get: async () => disk.raw,
      set: async (_k: string, raw: string | { text(): string }) => {
        const pending = disk.onSet?.();
        if (pending) await pending;
        if (guard.discarding) return 'fail';
        if (!lock.held) return 'browser-only';
        if (disk.failSet) throw new Error('IDB write failed');
        disk.raw = typeof raw === 'string' ? raw : raw.text();
        return 'ok';
      },
      del: async () => undefined,
    },
    cacheDb: { get: async () => undefined, set: async () => undefined },
    getAssetBlob: async () => new Blob(['img'], { type: 'image/png' }),
    putAssetBlob: async () => undefined,
    peekAssetUrl: () => undefined,
    loadAssetUrl: async () => null,
    deleteAssetBlobs: async () => undefined,
  };
});
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  probeMedia: async () => ({ width: 512, height: 512 }),
}));
vi.mock('../src/engine/design/raster', () => ({ flushRaster: async () => undefined }));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { guard } from '../src/lib/saveGuard';
import { saveNow, useStore } from '../src/store/store';
import { createGeneration, resumeInterrupted, runGeneration } from '../src/engine/jobs';
import { controllers, running } from '../src/engine/jobState';
import { ADAPTERS } from '../src/engine/providers/registry';
import { LOCAL_IMAGE_REF } from '../src/engine/providers/demo';
import type { ModelSummary } from '../src/engine/types';
import { SpaceBoard } from '../src/components/space/SpaceBoard';
import { mainThread } from './helpers/threads';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FREE_REMOTE = 'nanogpt::free-image';
const PAID_REMOTE = 'nanogpt::paid-image';
const sid = () => useStore.getState().activeSessionId;
const genOf = (id: string) => useStore.getState().generations[id];
const imgOut = (tag = 'x', costUsd = 0) => ({
  outputs: [{ blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png' }],
  costUsd,
});
const tick = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));
const reloadAndResume = async () => {
  running.clear();
  controllers.clear();
  await useStore.persist.rehydrate();
  await resumeInterrupted();
};

function setupCatalog() {
  const st = useStore.getState();
  const sId = st.activeSessionId;
  const mod = (ref: string, provider: 'local' | 'nanogpt', id: string, name: string, usd: number): ModelSummary =>
    ({
      ref,
      provider,
      id,
      name,
      kind: 'image',
      acceptsText: true,
      acceptsImage: provider === 'local',
      tags: provider === 'local' ? ['demo'] : [],
      price: { skus: [{ unit: 'output', usd }] },
    }) as ModelSummary;
  const sch = (ref: string, usd: number, source: 'builtin' | 'catalog' = 'catalog') => ({
    ref,
    params: [],
    slots: { prompt: 'prompt', promptRequired: true },
    source,
    price: { skus: [{ unit: 'output', usd }] },
  });
  useStore.setState({
    generations: {},
    tickets: {},
    quotes: {},
    assets: {},
    spendLog: [],
    spentUsd: 0,
    ui: { ...st.ui, toasts: [] },
    settings: {
      ...st.settings,
      keys: { ...st.settings.keys, nanogpt: 'k-n' },
      budgetOn: true,
      budgetUsd: 1,
      mutedNotices: [],
    },
    catalog: {
      ...st.catalog,
      models: {
        [LOCAL_IMAGE_REF]: mod(LOCAL_IMAGE_REF, 'local', 'studio-image', 'Local Sketch', 0),
        [FREE_REMOTE]: mod(FREE_REMOTE, 'nanogpt', 'free-image', 'Free Image', 0),
        [PAID_REMOTE]: mod(PAID_REMOTE, 'nanogpt', 'paid-image', 'Paid Image', 0.1),
      },
      schemas: {
        [LOCAL_IMAGE_REF]: sch(LOCAL_IMAGE_REF, 0, 'builtin'),
        [FREE_REMOTE]: sch(FREE_REMOTE, 0, 'catalog'),
        [PAID_REMOTE]: sch(PAID_REMOTE, 0.1, 'catalog'),
      },
    } as never,
    sessions: {
      ...st.sessions,
      [sId]: { ...st.sessions[sId], feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) },
    },
  });
}

let mountedRoot: Root | null = null;
let mountedHost: HTMLDivElement | null = null;
const cleanups: Array<() => void> = [];
function mount(el: React.ReactElement) {
  mountedHost = document.createElement('div');
  document.body.replaceChildren(mountedHost);
  mountedRoot = createRoot(mountedHost);
  act(() => mountedRoot!.render(el));
  return mountedHost;
}

beforeEach(() => {
  Object.assign(disk, { raw: undefined, failSet: false, onSet: undefined });
  lock.held = true;
  guard.discarding = false;
  running.clear();
  controllers.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new Error(`Unexpected fetch: ${url}`); }));
  setupCatalog();
});

afterEach(async () => {
  while (cleanups.length) cleanups.pop()?.();
  if (mountedRoot) {
    act(() => mountedRoot!.unmount());
    mountedRoot = null;
  }
  mountedHost?.remove();
  mountedHost = null;
  Object.assign(disk, { failSet: false, onSet: undefined });
  lock.held = true;
  guard.discarding = false;
  await saveNow().catch(() => undefined);
  running.clear();
  controllers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('local and free generation interrupted by reload', () => {
  it('Local Sketch in Create > Image stays visible as Interrupted with one-click free Retry after reload and never auto-resends', async () => {
    let release!: () => void;
    let calls = 0;
    const rendering = new Promise<void>((res) => {
      vi.spyOn(ADAPTERS.local, 'generate').mockImplementation(async (req) => {
        calls += 1;
        req.onStatus('Rendering');
        if (calls === 1) {
          res();
          await new Promise<void>((r) => { release = r; cleanups.push(r); });
          return imgOut('stale', 0);
        }
        return imgOut('retried', 0);
      });
    });

    const prompt = 'Un faro al amanecer durante una tormenta';
    const g = createGeneration({
      sessionId: sid(),
      origin: 'composer',
      place: 'space-create',
      kind: 'image',
      prompt,
      modelRef: LOCAL_IMAGE_REF,
      settings: { count: 1, advanced: {} },
      inputs: { refs: [] },
    });
    const firstRun = runGeneration(g.id).catch(() => undefined);
    await rendering;
    await tick(10);

    await reloadAndResume();

    const afterReload = genOf(g.id);
    expect(afterReload).toBeDefined();
    expect(afterReload.status).toBe('error');
    expect(afterReload.error).toMatch(/Interrupted by a page reload/i);
    expect(afterReload.lostJob).toBeFalsy();
    expect(afterReload.sends?.some((s) => s.status === 'uncertain')).toBeFalsy();
    expect(calls).toBe(1);
    expect(useStore.getState().ui.toasts.some((t) => /charged/i.test(t.text))).toBe(false);

    // Mount Create > Image SpaceBoard in default post-reload state (showFailed starts false).
    const host = mount(createElement(SpaceBoard, { place: 'space-create', kind: 'image' }));
    expect(host.querySelector('[aria-label="Ongoing"]')?.textContent).toContain('Nothing running.');
    const failed = host.querySelector('[aria-label="Failed"]');
    expect(failed).not.toBeNull();
    expect(failed!.textContent).toContain(prompt);
    expect(failed!.textContent).toMatch(/Interrupted/i);

    // One-click free Retry (even with budgetOn: true, budgetUsd: 1): no extra confirmation, completes into Done.
    const retryBtn = [...failed!.querySelectorAll('button')].find((b) => /Retry/i.test(b.textContent ?? ''));
    expect(retryBtn).toBeDefined();
    expect(retryBtn!.textContent).toMatch(/Free/i);

    await act(async () => {
      retryBtn!.click();
      await tick(30);
    });

    expect(calls).toBe(2);
    expect(useStore.getState().spentUsd).toBe(0);
    expect(host.querySelectorAll('.space-done .space-tile')).toHaveLength(1);
    expect(host.querySelector('[aria-label="Failed"]')).toBeNull();

    release();
    await firstRun;
  });

  it('Local Sketch survives immediate reload while async storage write is in progress (never disappears from store)', async () => {
    disk.onSet = () => tick(15);
    let release!: () => void;
    const rendering = new Promise<void>((res) => {
      vi.spyOn(ADAPTERS.local, 'generate').mockImplementationOnce(async (req) => {
        req.onStatus('Rendering');
        res();
        await new Promise<void>((r) => { release = r; cleanups.push(r); });
        return imgOut('stale', 0);
      });
    });

    const g = createGeneration({
      sessionId: sid(),
      origin: 'composer',
      place: 'space-create',
      kind: 'image',
      prompt: 'Fast reload during render',
      modelRef: LOCAL_IMAGE_REF,
      settings: { count: 1, advanced: {} },
      inputs: { refs: [] },
    });
    const firstRun = runGeneration(g.id).catch(() => undefined);
    await rendering;

    await reloadAndResume();

    expect(genOf(g.id)).toBeDefined();
    expect(genOf(g.id).status).toBe('error');
    expect(genOf(g.id).error).toMatch(/Interrupted by a page reload/i);
    expect(genOf(g.id).lostJob).toBeFalsy();

    release();
    await firstRun;
  });

  it('free remote ($0) generation in flight survives reload as visible Interrupted with one-click free Retry', async () => {
    disk.onSet = () => tick(10);
    let release!: () => void;
    let calls = 0;
    const inFlight = new Promise<void>((res) => {
      vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          res();
          await new Promise<void>((r) => { release = r; cleanups.push(r); });
          return imgOut('stale', 0);
        }
        return imgOut('free-ok', 0);
      });
    });

    const g = createGeneration({
      sessionId: sid(),
      origin: 'composer',
      place: 'space-create',
      kind: 'image',
      prompt: 'Free cloud sketch',
      modelRef: FREE_REMOTE,
      settings: { count: 1, advanced: {} },
      inputs: { refs: [] },
    });
    const firstRun = runGeneration(g.id).catch(() => undefined);
    await inFlight;

    await reloadAndResume();

    expect(genOf(g.id)).toMatchObject({ status: 'error' });
    expect(genOf(g.id).lostJob).toBeFalsy();
    expect(calls).toBe(1);

    const host = mount(createElement(SpaceBoard, { place: 'space-create', kind: 'image' }));
    const failed = host.querySelector('[aria-label="Failed"]');
    expect(failed).not.toBeNull();
    expect(failed!.textContent).toContain('Free cloud sketch');
    const retryBtn = [...failed!.querySelectorAll('button')].find((b) => /Retry/i.test(b.textContent ?? ''));
    expect(retryBtn).toBeDefined();

    await act(async () => {
      retryBtn!.click();
      await tick(30);
    });

    expect(calls).toBe(2);
    expect(useStore.getState().spentUsd).toBe(0);
    expect(host.querySelectorAll('.space-done .space-tile')).toHaveLength(1);

    release();
    await firstRun;
  });

  it('paid generation interrupted by reload does NOT get a one-click free Retry button on SpaceBoard', async () => {
    let release!: () => void;
    const inFlight = new Promise<void>((res) => {
      vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementationOnce(async () => {
        res();
        await new Promise<void>((r) => { release = r; cleanups.push(r); });
        return imgOut('paid', 0.1);
      });
    });

    const g = createGeneration({
      sessionId: sid(),
      origin: 'composer',
      place: 'space-create',
      kind: 'image',
      prompt: 'Paid lighthouse',
      modelRef: PAID_REMOTE,
      settings: { count: 1, advanced: {} },
      inputs: { refs: [] },
    });
    const firstRun = runGeneration(g.id).catch(() => undefined);
    await inFlight;

    await reloadAndResume();

    expect(genOf(g.id)).toMatchObject({ status: 'error', lostJob: true });
    const host = mount(createElement(SpaceBoard, { place: 'space-create', kind: 'image' }));
    act(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="Show failed"]')?.click();
    });
    const failed = host.querySelector('[aria-label="Failed"]');
    expect(failed).not.toBeNull();
    expect(failed!.textContent).toContain('Paid lighthouse');
    const retryBtn = [...failed!.querySelectorAll('button')].find((b) => /Retry/i.test(b.textContent ?? ''));
    expect(retryBtn).toBeUndefined();

    release();
    await firstRun;
  });

  it('local generation still completes when storage write fails', async () => {
    disk.failSet = true;
    const spy = vi.spyOn(ADAPTERS.local, 'generate').mockResolvedValue(imgOut('ok', 0));
    const g = createGeneration({
      sessionId: sid(),
      origin: 'composer',
      place: 'space-create',
      kind: 'image',
      prompt: 'Offline resilience',
      modelRef: LOCAL_IMAGE_REF,
      settings: { count: 1, advanced: {} },
      inputs: { refs: [] },
    });
    await expect(runGeneration(g.id)).resolves.toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(genOf(g.id).status).toBe('done');
  });
});
