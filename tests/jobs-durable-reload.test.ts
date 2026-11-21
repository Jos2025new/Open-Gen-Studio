import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({
  raw: undefined as string | undefined,
  onBlobPut: undefined as (() => Promise<void> | void) | undefined,
}));
vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: {
    get: async () => disk.raw,
    set: async (_k: string, raw: string | { text(): string }) => {
      disk.raw = typeof raw === 'string' ? raw : raw.text();
    },
    del: async () => undefined,
  },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob(['test'], { type: 'image/png' }),
  putAssetBlob: async () => { await disk.onBlobPut?.(); },
}));
vi.mock('../src/lib/media', async (original) => ({
  ...await original<typeof import('../src/lib/media')>(),
  probeMedia: async () => ({ width: 512, height: 512 }),
}));

import { useStore } from '../src/store/store';
import { createGeneration, resumeInterrupted, runGeneration } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import type { ModelSummary } from '../src/engine/types';
import { mainThread } from './helpers/threads';

const REF = 'nanogpt::seed';
const sid = () => useStore.getState().activeSessionId;

function savedGeneration(id: string) {
  const parsed = disk.raw ? JSON.parse(disk.raw) : null;
  return parsed?.state?.generations?.[id];
}

beforeEach(() => {
  disk.raw = undefined;
  disk.onBlobPut = undefined;
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [] })));
  const st = useStore.getState();
  useStore.setState({
    generations: {},
    quotes: {},
    assets: {},
    spendLog: [],
    spentUsd: 0,
    ui: { ...st.ui, toasts: [] },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'test-key' }, budgetOn: false, mutedNotices: [] },
    catalog: {
      ...st.catalog,
      models: { [REF]: { ref: REF, provider: 'nanogpt', id: 'seed', name: 'Seed', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] } } as ModelSummary },
      schemas: { [REF]: { ref: REF, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' } },
    },
    sessions: { ...st.sessions, [st.activeSessionId]: { ...st.sessions[st.activeSessionId], feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
});

afterEach(() => {
  disk.onBlobPut = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('durable send ledger across reloads in jobs.ts', () => {
  it('batch persists each request remoteJob immediately after onRemoteJob so a reload mid-batch resumes it', async () => {
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'a', modelRef: REF, settings: { count: 2, advanced: {} }, inputs: { refs: [] } });
    let call = 0;
    let releaseSecond!: () => void;
    const secondReached = new Promise<void>((resolve) => {
      vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async (req) => {
        call += 1;
        if (call === 1) {
          req.onRemoteJob?.({ provider: 'nanogpt', id: 'job_1', meta: { u: '1' } });
          return { outputs: [{ blob: new Blob(['a'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.1 };
        }
        req.onRemoteJob?.({ provider: 'nanogpt', id: 'job_2', meta: { u: '2' } });
        // Wait 10 ms (well under the 350 ms store debounce) so only an immediate flush can persist it.
        await new Promise((r) => setTimeout(r, 10));
        resolve();
        await new Promise<void>((r) => { releaseSecond = r; });
        return { outputs: [{ blob: new Blob(['b'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.1 };
      });
    });

    const running = runGeneration(g.id).catch(() => undefined);
    await secondReached;

    const saved = savedGeneration(g.id);
    expect(saved?.remoteJob).toMatchObject({ provider: 'nanogpt', id: 'job_2' });
    expect(saved?.sends).toHaveLength(2);
    expect(saved?.sends?.[0]).toMatchObject({ index: 0, status: 'done', remoteJob: { id: 'job_1' } });
    expect(saved?.sends?.[1]).toMatchObject({ index: 1, status: 'sent', remoteJob: { id: 'job_2' } });

    releaseSecond();
    await running;
  });

  it('keeps sending set until outputs are stored and patched, so a reload during storeOutput marks uncertain', async () => {
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'a', modelRef: REF, settings: { count: 1, advanced: {} }, inputs: { refs: [] } });
    let sendingDuringStore: number | undefined;
    let releaseStore!: () => void;
    const storing = new Promise<void>((resolve) => {
      disk.onBlobPut = async () => {
        sendingDuringStore = useStore.getState().generations[g.id]?.sending;
        resolve();
        await new Promise<void>((r) => { releaseStore = r; });
      };
    });

    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockResolvedValue({
      outputs: [{ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png' }],
      costUsd: 0.1,
    });

    const p = runGeneration(g.id);
    await storing;

    expect(sendingDuringStore).toEqual(expect.any(Number));
    expect(useStore.getState().generations[g.id].assetIds).toEqual([]);

    // Simulate reload while storeOutput is still saving the blob: resumeInterrupted sees sending / intent -> uncertain.
    const snapshot = JSON.parse(JSON.stringify(useStore.getState().generations[g.id]));
    useStore.setState((s) => ({ generations: { ...s.generations, [g.id]: { ...snapshot, status: 'running' } } }));
    await resumeInterrupted();
    const afterReload = useStore.getState().generations[g.id];
    expect(afterReload.status).toBe('error');
    expect(afterReload.lostJob).toBe(true);
    expect(afterReload.error).toMatch(/may have been sent and charged/i);

    releaseStore();
    await p.catch(() => undefined);
  });
});
