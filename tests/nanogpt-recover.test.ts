import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { nanogpt, pickRecoveredRun } from '../src/engine/providers/nanogpt';
import { ADAPTERS } from '../src/engine/providers/registry';
import { canRecheck, recheckGeneration } from '../src/engine/jobs';
import { useStore } from '../src/store/store';
import type { Generation } from '../src/engine/types';

// GET /api/generate-video/recover as documented (docs.nano-gpt.com/api-reference/endpoint/video-recover, pasted by the user).
const T0 = Date.parse('2026-09-27T22:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const run = (runId: string, at: number, model = 'bytedance-seedance-2-0-fast', status = 'completed') => ({ runId, id: runId, model, status, createdAt: iso(at), conversationUUID: 'c' });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('picking the run a lost request started', () => {
  const q = { modelId: 'bytedance-seedance-2-0-fast', since: T0, until: T0 + 40_000, taken: new Set<string>() };
  it('takes the run created between the submit and the failure, closest to the submit', () => {
    expect(pickRecoveredRun([run('vid_old', T0 - 10 * 60_000), run('vid_mine', T0 + 2_000), run('vid_next', T0 + 90_000)], q)).toBe('vid_mine');
  });
  it('allows a small clock difference but ignores older runs, other models and runs other generations own', () => {
    expect(pickRecoveredRun([run('vid_skew', T0 - 20_000)], q)).toBe('vid_skew');
    expect(pickRecoveredRun([run('vid_old', T0 - 5 * 60_000)], q)).toBeNull();
    expect(pickRecoveredRun([run('vid_x', T0 + 1_000, 'sora-2')], q)).toBeNull();
    expect(pickRecoveredRun([run('vid_mine', T0 + 1_000)], { ...q, taken: new Set(['vid_mine']) })).toBeNull();
  });
});

describe('Check status for a NanoGPT video whose job id was lost', () => {
  let recoverUrl = '';
  let recoverKey = '';
  let runs: unknown[] = [];
  beforeEach(() => {
    recoverUrl = '';
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      recoverUrl = url;
      recoverKey = new Headers(init?.headers).get('x-api-key') ?? '';
      return new Response(JSON.stringify({ data: runs }), { headers: { 'content-type': 'application/json' } });
    });
    const st = useStore.getState();
    const g: Generation = {
      id: 'gen_lost', sessionId: st.activeSessionId, kind: 'video', prompt: 'she shows the dress', modelRef: 'nanogpt::bytedance-seedance-2-0-fast', modelName: 'Seedance 2.0 Fast', provider: 'nanogpt',
      settings: { count: 1, advanced: {} }, inputs: { refs: [] }, status: 'error', error: 'Network error reaching nano-gpt.com. Check your connection.', lostJob: true,
      assetIds: [], createdAt: T0, startedAt: T0, finishedAt: T0 + 30_000, estimate: { usd: 0.6, approximate: false },
    } as Generation;
    useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' } }, generations: { ...st.generations, gen_lost: g } });
  });

  it('asks recover for that model, adopts the run and follows it', async () => {
    runs = [run('vid_mine', T0 + 3_000)];
    const resume = vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValue({ outputs: [] });
    expect(canRecheck(useStore.getState().generations.gen_lost)).toBe(true);
    await recheckGeneration('gen_lost');
    expect(recoverUrl).toBe('https://nano-gpt.com/api/generate-video/recover?model=bytedance-seedance-2-0-fast&limit=20');
    expect(recoverKey).toBe('k');
    expect(resume.mock.calls[0][0]).toMatchObject({ provider: 'nanogpt', id: 'vid_mine' });
    expect(useStore.getState().generations.gen_lost.jobId).toBe('vid_mine');
  });

  it('says the request never arrived when NanoGPT has no such run, and leaves Retry', async () => {
    runs = [run('vid_old', T0 - 10 * 60_000)];
    await recheckGeneration('gen_lost');
    const g = useStore.getState().generations.gen_lost;
    expect(g.status).toBe('error');
    expect(g.error).toMatch(/no recent job for this request.*never arrived.*Retry/);
  });

  it('a request NanoGPT answered with an error (not a lost connection) offers no Check status', () => {
    const g = { ...useStore.getState().generations.gen_lost, lostJob: undefined };
    expect(canRecheck(g)).toBe(false);
    expect(nanogpt.recover).toBeTypeOf('function');
  });
});
