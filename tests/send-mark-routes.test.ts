import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({
  raw: undefined as string | undefined,
  onRead: undefined as (() => void) | undefined,
  failSet: false,
  hangSet: false,
  unblock: undefined as (() => void) | undefined,
}));
const lock = vi.hoisted(() => ({ held: true }));
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/writerLock', async (orig) => {
  const m = await orig<typeof import('../src/lib/writerLock')>();
  return { ...m, holdsWriterLock: () => lock.held };
});
vi.mock('../src/lib/idb', () => ({
  stateDb: {
    get: async () => disk.raw,
    set: async (_k: string, raw: string | { text(): string }) => {
      if (disk.hangSet) await new Promise<void>((resolve) => { disk.unblock = resolve; });
      if (disk.failSet) throw new Error('IDB write failed');
      disk.raw = typeof raw === 'string' ? raw : raw.text();
    },
    del: async () => undefined,
  },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => { disk.onRead?.(); return new Blob(['test'], { type: 'image/png' }); }, putAssetBlob: async () => undefined,
}));
vi.mock('../src/lib/media', async (original) => ({ ...await original<typeof import('../src/lib/media')>(),
  probeMedia: async () => ({ width: 1, height: 1 }) }));

import { useStore } from '../src/store/store';
import { guard } from '../src/lib/saveGuard';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { ADAPTERS } from '../src/engine/providers/registry';
import { RECRAFT_STYLE_REF } from '../src/engine/catalog';
import { mainThread } from './helpers/threads';

/* Routes that send outside the media path also mark the send before it leaves (a reload after it must say "may have been charged"). */
let seen: number | undefined;
beforeEach(() => {
  disk.failSet = false;
  disk.hangSet = false;
  disk.unblock = undefined;
  lock.held = true;
  guard.discarding = false;
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [] })));
  const st = useStore.getState();
  useStore.setState({
    generations: {}, assets: { a1: { id: 'a1', kind: 'image', mime: 'image/png', width: 1, height: 1, sessionId: st.activeSessionId, origin: 'upload', stored: true, favorite: false, createdAt: 1 } as never },
    settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' }, budgetOn: false },
    sessions: { ...st.sessions, [st.activeSessionId]: { ...st.sessions[st.activeSessionId], feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
});
afterEach(() => {
  disk.unblock?.();
  disk.unblock = undefined;
  disk.failSet = false;
  disk.hangSet = false;
  lock.held = true;
  guard.discarding = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  disk.onRead = undefined;
});
const sendingOf = (id: string) => useStore.getState().generations[id]?.sending;
const TR = 'nanogpt::transcriber';
function audio() {
  const st = useStore.getState();
  useStore.setState({ assets: { ...st.assets, au: { id: 'au', kind: 'audio', mime: 'audio/mpeg', duration: 10, sessionId: st.activeSessionId, origin: 'upload', stored: true, favorite: false, createdAt: 1 } as never },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k', fal: 'k' } },
    catalog: { ...st.catalog, transcribers: { [TR]: { ref: TR, provider: 'nanogpt', name: 'Test transcriber', id: 'transcriber', usdPerMinute: 0.01, maxDirectBytes: 1000000, video: false, diarization: false } } } as never });
}
const opGen = (op: string, modelRef: string) => createGeneration({ sessionId: useStore.getState().activeSessionId, origin: 'op', kind: 'text', prompt: '', modelRef, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, op: { id: op, sourceAssetId: 'au', params: { language: 'es' } } } as never);

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

  it('Recraft style: the inputs are read before the mark (a reload while reading them is not a possible charge)', async () => {
    const g = createGeneration({ sessionId: useStore.getState().activeSessionId, origin: 'composer', kind: 'text', prompt: 'style', modelRef: RECRAFT_STYLE_REF, settings: { count: 1, advanced: {} }, inputs: { refs: ['a1'] } });
    const atRead: Array<number | undefined> = [];
    disk.onRead = () => atRead.push(sendingOf(g.id));
    vi.spyOn(ADAPTERS.fal, 'createStyle').mockResolvedValue({ text: 'sty_1', costUsd: 0.04 } as never);
    await runGeneration(g.id);
    expect(atRead.length).toBeGreaterThan(0);
    expect(atRead.every((v) => v === undefined)).toBe(true);
  });

  it('Kling voice: the clip is read before the mark, marked while the request is out, cleared when it answers', async () => {
    audio();
    const g = opGen('create_voice', 'fal::kling-voice');
    const atRead: Array<number | undefined> = [];
    disk.onRead = () => atRead.push(sendingOf(g.id));
    let during: number | undefined;
    vi.spyOn(ADAPTERS.fal, 'createVoice').mockImplementation(async () => { during = sendingOf(g.id); return { text: 'voice_1', costUsd: 0.05 } as never; });
    await runGeneration(g.id);
    expect(atRead.length).toBeGreaterThan(0);
    expect(atRead.every((v) => v === undefined)).toBe(true);
    expect(during).toEqual(expect.any(Number));
    expect(sendingOf(g.id)).toBeUndefined();
    expect(useStore.getState().generations[g.id].status).toBe('done');
  });

  it('transcription answered at once: read before the mark, marked while out, cleared by finishText', async () => {
    audio();
    const g = opGen('transcribe', TR);
    const atRead: Array<number | undefined> = [];
    disk.onRead = () => atRead.push(sendingOf(g.id));
    let during: number | undefined;
    vi.spyOn(ADAPTERS.nanogpt, 'transcribe').mockImplementation(async () => { during = sendingOf(g.id); return { text: 'hola', costUsd: 0.01 } as never; });
    await runGeneration(g.id);
    expect(atRead.every((v) => v === undefined)).toBe(true);
    expect(during).toEqual(expect.any(Number));
    expect(sendingOf(g.id)).toBeUndefined();
    expect(useStore.getState().generations[g.id]).toMatchObject({ status: 'done', text: 'hola' });
  });

  it('transcription answered with 202: the stored job replaces the mark (a reload follows the job, not "may have been charged")', async () => {
    audio();
    const g = opGen('transcribe', TR);
    let afterJob: { sending?: number; remoteJob?: unknown } = {};
    vi.spyOn(ADAPTERS.nanogpt, 'transcribe').mockImplementation(async (req) => {
      expect(sendingOf(g.id)).toEqual(expect.any(Number));
      req.onRemoteJob?.({ provider: 'nanogpt', id: 't1', meta: {} } as never);
      const now = useStore.getState().generations[g.id];
      afterJob = { sending: now.sending, remoteJob: now.remoteJob };
      return { text: 'hola', costUsd: 0.01 } as never;
    });
    await runGeneration(g.id);
    expect(afterJob.sending).toBeUndefined();
    expect(afterJob.remoteJob).toMatchObject({ id: 't1' });
    expect(useStore.getState().generations[g.id]).toMatchObject({ status: 'done', remoteJob: undefined, sending: undefined });
  });
});

function setupMediaModel() {
  const REF = 'nanogpt::seed';
  const st = useStore.getState();
  useStore.setState({
    catalog: {
      ...st.catalog,
      models: { [REF]: { ref: REF, provider: 'nanogpt', id: 'seed', name: 'seed', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] } } as never },
      schemas: { [REF]: { ref: REF, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' } } as never,
    },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' } },
  });
  return REF;
}

describe('strict pre-send save gate (zero POST on save failure, 8s timeout, discarding, or no lock)', () => {
  it('media route: zero POST when saveNow rejects, times out (>8s), guard.discarding is true, or writer lock is lost', async () => {
    const ref = setupMediaModel();
    const genSpy = vi.spyOn(ADAPTERS.nanogpt, 'generate').mockResolvedValue({ outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }] } as never);

    // 1) saveNow rejects
    disk.failSet = true;
    const g1 = createGeneration({ sessionId: useStore.getState().activeSessionId, origin: 'composer', kind: 'image', prompt: 'a', modelRef: ref, settings: { count: 1, advanced: {} }, inputs: { refs: [] } });
    await expect(runGeneration(g1.id)).rejects.toThrow(/not sent/i);
    expect(genSpy).not.toHaveBeenCalled();
    expect(useStore.getState().generations[g1.id]).toMatchObject({ status: 'error', sending: undefined, lostJob: false });
    expect(useStore.getState().generations[g1.id].error).toMatch(/nothing was charged/i);
    disk.failSet = false;

    // 2) guard.discarding
    guard.discarding = true;
    const g2 = createGeneration({ sessionId: useStore.getState().activeSessionId, origin: 'composer', kind: 'image', prompt: 'a', modelRef: ref, settings: { count: 1, advanced: {} }, inputs: { refs: [] } });
    await expect(runGeneration(g2.id)).rejects.toThrow(/not sent/i);
    expect(genSpy).not.toHaveBeenCalled();
    expect(useStore.getState().generations[g2.id].sending).toBeUndefined();
    guard.discarding = false;

    // 3) !holdsWriterLock()
    lock.held = false;
    const g3 = createGeneration({ sessionId: useStore.getState().activeSessionId, origin: 'composer', kind: 'image', prompt: 'a', modelRef: ref, settings: { count: 1, advanced: {} }, inputs: { refs: [] } });
    await expect(runGeneration(g3.id)).rejects.toThrow(/not sent/i);
    expect(genSpy).not.toHaveBeenCalled();
    expect(useStore.getState().generations[g3.id].sending).toBeUndefined();
    lock.held = true;

    // 4) 8s timeout cap
    vi.useFakeTimers();
    disk.hangSet = true;
    const g4 = createGeneration({ sessionId: useStore.getState().activeSessionId, origin: 'composer', kind: 'image', prompt: 'a', modelRef: ref, settings: { count: 1, advanced: {} }, inputs: { refs: [] } });
    const p4 = runGeneration(g4.id);
    const caught = p4.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(8000);
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/not sent/i);
    expect(genSpy).not.toHaveBeenCalled();
    expect(useStore.getState().generations[g4.id]).toMatchObject({ status: 'error', sending: undefined });
  });

  it('all three special routes (style, voice, transcribe) perform zero POSTs when save fails, times out, discarding, or lock is lost', async () => {
    audio();
    const styleSpy = vi.spyOn(ADAPTERS.fal, 'createStyle').mockResolvedValue({ text: 'sty_1', costUsd: 0.04 } as never);
    const voiceSpy = vi.spyOn(ADAPTERS.fal, 'createVoice').mockResolvedValue({ text: 'voice_1', costUsd: 0.05 } as never);
    const transcribeSpy = vi.spyOn(ADAPTERS.nanogpt, 'transcribe').mockResolvedValue({ text: 'hola', costUsd: 0.01 } as never);

    const makeSpecials = () => ([
      createGeneration({ sessionId: useStore.getState().activeSessionId, origin: 'composer', kind: 'text', prompt: 'style', modelRef: RECRAFT_STYLE_REF, settings: { count: 1, advanced: {} }, inputs: { refs: ['a1'] } }),
      opGen('create_voice', 'fal::kling-voice'),
      opGen('transcribe', TR),
    ]);

    for (const setupFailure of [
      () => { disk.failSet = true; },
      () => { guard.discarding = true; },
      () => { lock.held = false; },
    ]) {
      disk.failSet = false; guard.discarding = false; lock.held = true;
      setupFailure();
      for (const g of makeSpecials()) {
        await expect(runGeneration(g.id)).rejects.toThrow(/not sent/i);
        expect(useStore.getState().generations[g.id]).toMatchObject({ status: 'error', sending: undefined });
      }
    }

    disk.failSet = false; guard.discarding = false; lock.held = true;
    vi.useFakeTimers();
    disk.hangSet = true;
    for (const g of makeSpecials()) {
      const p = runGeneration(g.id).catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(8000);
      const err = await p;
      expect((err as Error).message).toMatch(/not sent/i);
      expect(useStore.getState().generations[g.id]).toMatchObject({ status: 'error', sending: undefined });
      disk.unblock?.();
      disk.unblock = undefined;
    }

    expect(styleSpy).not.toHaveBeenCalled();
    expect(voiceSpy).not.toHaveBeenCalled();
    expect(transcribeSpy).not.toHaveBeenCalled();
  });
});
