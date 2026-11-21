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

import { saveNow, useStore } from '../src/store/store';
import { canRecheck, createGeneration, recheckGeneration, resumeInterrupted, runGeneration } from '../src/engine/jobs';
import { RECRAFT_STYLE_REF } from '../src/engine/catalog';
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

describe('durable send ledger across reloads in specialSends.ts', () => {
  it.each([
    ['transcribe', () => {
      const st = useStore.getState();
      const TR = 'nanogpt::transcriber';
      useStore.setState({
        assets: { ...st.assets, au: { id: 'au', kind: 'audio', mime: 'audio/mpeg', duration: 10, sessionId: sid(), origin: 'upload', stored: true, favorite: false, createdAt: 1 } as never },
        catalog: { ...st.catalog, transcribers: { [TR]: { ref: TR, provider: 'nanogpt', name: 'T', id: 'transcriber', usdPerMinute: 0.01, maxDirectBytes: 1_000_000, video: false, diarization: false } } } as never,
      });
      return {
        g: createGeneration({ sessionId: sid(), origin: 'op', kind: 'text', prompt: '', modelRef: TR, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, op: { id: 'transcribe', sourceAssetId: 'au', params: { language: 'es' } } } as never),
        spy: () => vi.spyOn(ADAPTERS.nanogpt, 'transcribe'),
        job: { provider: 'nanogpt' as const, id: 'tr_1', meta: {} },
      };
    }],
    ['createVoice', () => {
      const st = useStore.getState();
      useStore.setState({
        assets: { ...st.assets, au: { id: 'au', kind: 'audio', mime: 'audio/mpeg', duration: 10, sessionId: sid(), origin: 'upload', stored: true, favorite: false, createdAt: 1 } as never },
        settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' } },
      });
      return {
        g: createGeneration({ sessionId: sid(), origin: 'op', kind: 'text', prompt: '', modelRef: 'fal::kling-voice', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, op: { id: 'create_voice', sourceAssetId: 'au', params: {} } } as never),
        spy: () => vi.spyOn(ADAPTERS.fal, 'createVoice'),
        job: { provider: 'fal' as const, id: 'vc_1', meta: {} },
      };
    }],
    ['createStyle', () => {
      const st = useStore.getState();
      useStore.setState({
        assets: { ...st.assets, a1: { id: 'a1', kind: 'image', mime: 'image/png', width: 1, height: 1, sessionId: sid(), origin: 'upload', stored: true, favorite: false, createdAt: 1 } as never },
        settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' } },
      });
      return {
        g: createGeneration({ sessionId: sid(), origin: 'composer', kind: 'text', prompt: 'style', modelRef: RECRAFT_STYLE_REF, settings: { count: 1, advanced: {} }, inputs: { refs: ['a1'] } }),
        spy: () => vi.spyOn(ADAPTERS.fal, 'createStyle'),
        job: { provider: 'fal' as const, id: 'st_1', meta: {} },
      };
    }],
  ])('%s flushes remoteJob on onRemoteJob and marks send done + flushes on finish', async (_name, setup) => {
    const { g, spy, job } = setup();
    let release!: () => void;
    const jobFlushed = new Promise<void>((resolve) => {
      spy().mockImplementation(async (req) => {
        req.onRemoteJob?.(job as never);
        await new Promise((r) => setTimeout(r, 10));
        resolve();
        await new Promise<void>((r) => { release = r; });
        return { outputs: [], text: 'ok_result', costUsd: 0.02 } as never;
      });
    });

    const p = runGeneration(g.id);
    await jobFlushed;
    const mid = savedGeneration(g.id);
    expect(mid?.remoteJob).toMatchObject({ id: job.id });
    expect(mid?.sends?.[0]).toMatchObject({ index: 0, status: 'sent', remoteJob: { id: job.id } });

    release();
    await p;
    const end = savedGeneration(g.id);
    expect(end?.status).toBe('done');
    expect(end?.text).toBe('ok_result');
    expect(end?.sends?.[0]).toMatchObject({ index: 0, status: 'done', remoteJob: { id: job.id } });
  });
});

describe('per-request recovery, reentry preservation, and idempotent rehydration', () => {
  it('execute() does not erase remoteJob or lostJob on reentry', async () => {
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'a', modelRef: REF, settings: { count: 1, advanced: {} }, inputs: { refs: [] } });
    useStore.setState((s) => ({
      generations: {
        ...s.generations,
        [g.id]: { ...s.generations[g.id], remoteJob: { provider: 'nanogpt', id: 'kept_1', meta: {} }, lostJob: true },
      },
    }));
    let seenDuring: { remoteJobId?: string; lostJob?: boolean } = {};
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementationOnce(async () => {
      const cur = useStore.getState().generations[g.id];
      seenDuring = { remoteJobId: cur.remoteJob?.id, lostJob: cur.lostJob };
      throw new Error('stop');
    });
    await runGeneration(g.id).catch(() => undefined);
    expect(seenDuring).toEqual({ remoteJobId: 'kept_1', lostJob: true });
  });

  it('followRemote preserves prior assetIds from earlier batch requests', async () => {
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'a', modelRef: REF, settings: { count: 2, advanced: {} }, inputs: { refs: [] } });
    useStore.setState((s) => ({
      assets: {
        ...s.assets,
        ast_prev: { id: 'ast_prev', kind: 'image', mime: 'image/png', width: 512, height: 512, sessionId: sid(), origin: 'generated', stored: true, favorite: false, createdAt: 1 } as never,
      },
      generations: {
        ...s.generations,
        [g.id]: {
          ...s.generations[g.id],
          status: 'error',
          assetIds: ['ast_prev'],
          remoteJob: { provider: 'nanogpt', id: 'j_2', meta: {} },
          sends: [
            { id: 'r0', index: 0, status: 'done', remoteJob: { provider: 'nanogpt', id: 'j_1', meta: {} } },
            { id: 'r1', index: 1, status: 'sent', remoteJob: { provider: 'nanogpt', id: 'j_2', meta: {} } },
          ],
        },
      },
    }));
    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValueOnce({
      outputs: [{ blob: new Blob(['two'], { type: 'image/png' }), mime: 'image/png' }],
      costUsd: 0.1,
    });
    const added = await recheckGeneration(g.id);
    expect(added).toHaveLength(1);
    expect(useStore.getState().generations[g.id].assetIds).toEqual(['ast_prev', added[0]]);
  });

  it('canRecheck and recheckGeneration recover a pending request from g.sends even when top-level remoteJob is absent', async () => {
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'a', modelRef: REF, settings: { count: 2, advanced: {} }, inputs: { refs: [] } });
    useStore.setState((s) => ({
      generations: {
        ...s.generations,
        [g.id]: {
          ...s.generations[g.id],
          status: 'error',
          remoteJob: undefined,
          sends: [
            { id: 'r0', index: 0, status: 'done', remoteJob: { provider: 'nanogpt', id: 'j_1', meta: {} } },
            { id: 'r1', index: 1, status: 'sent', remoteJob: { provider: 'nanogpt', id: 'j_from_sends', meta: {} } },
          ],
        },
      },
    }));
    expect(canRecheck(useStore.getState().generations[g.id])).toBe(true);
    const spy = vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValueOnce({
      outputs: [{ blob: new Blob(['ok'], { type: 'image/png' }), mime: 'image/png' }],
      costUsd: 0.1,
    });
    await recheckGeneration(g.id);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].id).toBe('j_from_sends');
  });

  it('rehydrating twice yields a single spend and a single delivery', async () => {
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'a', modelRef: REF, settings: { count: 1, advanced: {} }, inputs: { refs: [] } });
    useStore.setState((s) => ({
      generations: {
        ...s.generations,
        [g.id]: {
          ...s.generations[g.id],
          status: 'running',
          remoteJob: { provider: 'nanogpt', id: 'j_once', meta: {} },
          sends: [{ id: 'r0', index: 0, status: 'sent', remoteJob: { provider: 'nanogpt', id: 'j_once', meta: {} } }],
        },
      },
    }));
    await saveNow();

    let release!: () => void;
    const resumeSpy = vi.spyOn(ADAPTERS.nanogpt, 'resume').mockImplementation(async () => {
      await new Promise<void>((r) => { release = r; });
      return { outputs: [{ blob: new Blob(['img'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.1 };
    });

    // Two concurrent resumeInterrupted calls before completion: deduplicated.
    const first = resumeInterrupted();
    const second = resumeInterrupted();
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([first, second]);
    await new Promise((r) => setTimeout(r, 10));

    // Second full store rehydrate + resumeInterrupted after completion: still 1 spend and 1 delivery.
    await useStore.persist.rehydrate();
    await resumeInterrupted();

    const st = useStore.getState();
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(st.spendLog).toHaveLength(1);
    expect(st.spentUsd).toBeCloseTo(0.1);
    expect(st.generations[g.id].assetIds).toHaveLength(1);
    expect(Object.keys(st.assets)).toHaveLength(1);
  });
});
