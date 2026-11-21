// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({
  raw: undefined as string | undefined, failSet: false, hangSet: false,
  unblock: undefined as (() => void) | undefined,
  onSet: undefined as (() => Promise<void> | void) | undefined,
  onBlobGet: undefined as (() => Promise<void> | void) | undefined,
  onBlobPut: undefined as (() => Promise<void> | void) | undefined,
}));
const lock = vi.hoisted(() => ({ held: true }));

vi.mock('../src/lib/writerLock', async (orig) => ({ ...(await orig<typeof import('../src/lib/writerLock')>()), holdsWriterLock: () => lock.held, mayStartWork: () => lock.held }));
vi.mock('../src/lib/idb', async () => {
  const { guard } = await import('../src/lib/saveGuard');
  return {
    stateDb: {
      get: async () => disk.raw,
      set: async (_k: string, raw: string | { text(): string }) => {
        if (disk.onSet) await disk.onSet();
        if (guard.discarding) return 'fail';
        if (!lock.held) return 'browser-only';
        if (disk.hangSet) await new Promise<void>((r) => { disk.unblock = r; });
        if (disk.failSet) throw new Error('IDB write failed');
        disk.raw = typeof raw === 'string' ? raw : raw.text();
        return 'ok';
      },
      del: async () => undefined,
    },
    cacheDb: { get: async () => undefined, set: async () => undefined },
    getAssetBlob: async () => { if (disk.onBlobGet) await disk.onBlobGet(); return new Blob(['img'], { type: 'image/png' }); },
    putAssetBlob: async () => { if (disk.onBlobPut) await disk.onBlobPut(); },
    deleteAssetBlobs: async () => undefined,
  };
});
vi.mock('../src/lib/media', async (orig) => ({ ...(await orig<typeof import('../src/lib/media')>()), probeMedia: async () => ({ width: 512, height: 512 }) }));
vi.mock('../src/engine/design/raster', () => ({ flushRaster: async () => undefined }));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { guard } from '../src/lib/saveGuard';
import { HttpError, JobFailedError } from '../src/lib/http';
import { saveNow, useStore } from '../src/store/store';
import { RECRAFT_STYLE_REF } from '../src/engine/catalog';
import { forgetBalances, onGenerationCredit } from '../src/engine/credit';
import { estimateSteps, executeSteps } from '../src/engine/executor';
import { cancelGeneration, canRecheck, createGeneration, recheckGeneration, resumeInterrupted, runGeneration } from '../src/engine/jobs';
import { activeRemoteJob } from '../src/engine/jobRecovery';
import { controllers, running } from '../src/engine/jobState';
import { ADAPTERS } from '../src/engine/providers/registry';
import { LOCAL_IMAGE_REF } from '../src/engine/providers/demo';
import type { Generation, ModelSummary, PlanFeedItem, PlanStep } from '../src/engine/types';
import { GenerationRecovery, PlanRecoveryChips } from '../src/components/chat/RecoveryActions';
import { mainThread } from './helpers/threads';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NANO = 'nanogpt::seed', ATLAS = 'atlas::seed', TR = 'nanogpt::transcriber';
const sid = () => useStore.getState().activeSessionId;
const genOf = (id: string) => useStore.getState().generations[id];
const savedGen = (id: string): Generation | undefined => (disk.raw ? JSON.parse(disk.raw)?.state?.generations?.[id] : undefined);
const imgOut = (tag = 'x', costUsd: number | undefined = 0.1) => ({ outputs: [{ blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png' }], costUsd });
const patchG = (id: string, patch: Partial<Generation>) => useStore.setState((s) => ({ generations: { ...s.generations, [id]: { ...s.generations[id], ...patch } } }));
const reloadAndResume = async () => { running.clear(); controllers.clear(); await useStore.persist.rehydrate(); await resumeInterrupted(); };
const rj = (id: string) => ({ provider: 'nanogpt' as const, id, meta: {} });
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const spyN = () => vi.spyOn(ADAPTERS.nanogpt, 'generate');
const spyR = () => vi.spyOn(ADAPTERS.nanogpt, 'resume');
const spyA = () => vi.spyOn(ADAPTERS.atlas, 'generate');
const toasts = () => useStore.getState().ui.toasts;
const rehydrate = () => useStore.persist.rehydrate();
const defSet = { count: 1, advanced: {} };
const mkStep = (id: string, after?: string[]): PlanStep => ({ id, kind: 'image', title: id, prompt: id, modelRef: NANO, settings: defSet, refs: [], ...(after ? { after } : {}) } as never);
const putPlan = (id: string, planId: string, status: PlanFeedItem['status'], steps: PlanStep[], stepStates: Record<string, string>, stepGenerations: Record<string, string> = {}): PlanFeedItem => {
  const item = { id, type: 'plan', status, workspace: 'chat', plan: { id: planId, title: planId, summary: planId, workspace: 'chat', steps }, stepStates, stepGenerations, stepAuthorizations: estimateSteps(steps).authorizations, createdAt: 1 } as never as PlanFeedItem;
  const sId = sid();
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sId]: { ...s.sessions[sId], feed: [item] } } }));
  return item;
};

function setupCatalog(extra?: { budgetOn?: boolean; budgetLimit?: number; autoSwitch?: 'ask' | 'always' }) {
  const st = useStore.getState(), sId = st.activeSessionId;
  const mod = (ref: string, provider: 'nanogpt' | 'atlas' | 'local', id: string, name: string, usd: number): ModelSummary =>
    ({ ref, provider, id, name, kind: 'image', acceptsText: true, acceptsImage: provider === 'local', tags: provider === 'local' ? ['demo'] : [], price: { skus: [{ unit: 'output', usd }] } } as ModelSummary);
  useStore.setState({
    generations: {}, quotes: {}, spendLog: [], spentUsd: 0, ui: { ...st.ui, toasts: [] },
    assets: {
      a1: { id: 'a1', kind: 'image', mime: 'image/png', width: 512, height: 512, sessionId: sId, origin: 'upload', stored: true, favorite: false, createdAt: 1 } as never,
      au: { id: 'au', kind: 'audio', mime: 'audio/mpeg', duration: 10, sessionId: sId, origin: 'upload', stored: true, favorite: false, createdAt: 1 } as never,
    },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k-n', atlas: 'k-a', fal: 'k-f' }, budgetOn: extra?.budgetOn ?? false, budgetUsd: extra?.budgetLimit ?? 25, autoSwitchProvider: extra?.autoSwitch ?? 'ask', mutedNotices: [] },
    catalog: {
      ...st.catalog,
      models: { [NANO]: mod(NANO, 'nanogpt', 'seed', 'Seed', 0.1), [ATLAS]: mod(ATLAS, 'atlas', 'seed', 'Seed', 0.08), [LOCAL_IMAGE_REF]: mod(LOCAL_IMAGE_REF, 'local', 'studio-image', 'Local Sketch', 0) },
      schemas: {
        [NANO]: { ref: NANO, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' },
        [ATLAS]: { ref: ATLAS, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' },
        [LOCAL_IMAGE_REF]: { ref: LOCAL_IMAGE_REF, params: [], source: 'builtin', slots: { prompt: 'prompt', promptRequired: true }, price: { skus: [{ unit: 'output', usd: 0 }] } },
      },
      transcribers: { [TR]: { ref: TR, provider: 'nanogpt', name: 'Test STT', id: 'transcriber', usdPerMinute: 0.01, maxDirectBytes: 1_000_000, video: false, diarization: false } },
    } as never,
    sessions: { ...st.sessions, [sId]: { ...st.sessions[sId], feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
}

const makeMedia = (opts?: { modelRef?: string; count?: number; planId?: string; stepId?: string }) =>
  createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'adv', modelRef: opts?.modelRef ?? NANO, settings: { count: opts?.count ?? 1, advanced: {} }, inputs: { refs: [] }, planId: opts?.planId, stepId: opts?.stepId });

let mountedRoot: Root | null = null;
function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  mountedRoot = createRoot(host);
  act(() => mountedRoot!.render(el));
  return host;
}

beforeEach(() => {
  Object.assign(disk, { raw: undefined, failSet: false, hangSet: false, unblock: undefined, onSet: undefined, onBlobGet: undefined, onBlobPut: undefined });
  lock.held = true; guard.discarding = false;
  running.clear(); controllers.clear(); forgetBalances();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new Error(`Unexpected fetch: ${url}`); }));
  setupCatalog();
});

afterEach(() => {
  if (mountedRoot) { act(() => mountedRoot!.unmount()); mountedRoot = null; }
  disk.unblock?.();
  Object.assign(disk, { unblock: undefined, failSet: false, hangSet: false, onSet: undefined, onBlobGet: undefined, onBlobPut: undefined });
  lock.held = true; guard.discarding = false;
  running.clear(); controllers.clear();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('1. Puerta de 8 s y rutas de envío', () => {
  it('lote: 0 POST del 2.º envío si falla el guardado', async () => {
    let calls = 0;
    const spy = spyN().mockImplementation(async () => { if (++calls === 1) disk.failSet = true; return imgOut(`b${calls}`); });
    const g = makeMedia({ count: 2 });
    await expect(runGeneration(g.id)).rejects.toThrow(/not sent/i);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(genOf(g.id).assetIds).toHaveLength(1);
    expect(genOf(g.id).sends?.map((s) => s.status)).toEqual(['done']);
  });

  it('especiales: 0 POST si discarding o pérdida de candado ocurren durante saveNow', async () => {
    const s1 = vi.spyOn(ADAPTERS.fal, 'createStyle').mockResolvedValue({ outputs: [], text: 'sty_1', costUsd: 0.04 });
    const s2 = vi.spyOn(ADAPTERS.fal, 'createVoice').mockResolvedValue({ outputs: [], text: 'vc_1', costUsd: 0.05 });
    const s3 = vi.spyOn(ADAPTERS.nanogpt, 'transcribe').mockResolvedValue({ outputs: [], text: 'hola', costUsd: 0.01 });
    const specials = () => [
      createGeneration({ sessionId: sid(), origin: 'composer', kind: 'text', prompt: 'style', modelRef: RECRAFT_STYLE_REF, settings: defSet, inputs: { refs: ['a1'] } }),
      createGeneration({ sessionId: sid(), origin: 'op', kind: 'text', prompt: '', modelRef: 'fal::kling-voice', settings: defSet, inputs: { refs: [] }, op: { id: 'create_voice', sourceAssetId: 'au', params: {} } } as never),
      createGeneration({ sessionId: sid(), origin: 'op', kind: 'text', prompt: '', modelRef: TR, settings: defSet, inputs: { refs: [] }, op: { id: 'transcribe', sourceAssetId: 'au', params: { language: 'es' } } } as never),
    ];
    for (const flip of [() => { guard.discarding = true; }, () => { lock.held = false; }]) {
      for (const g of specials()) {
        guard.discarding = false; lock.held = true; disk.onSet = flip;
        await expect(runGeneration(g.id)).rejects.toThrow(/not sent/i);
        expect(genOf(g.id).sending).toBeUndefined();
      }
    }
    expect(s1).not.toHaveBeenCalled(); expect(s2).not.toHaveBeenCalled(); expect(s3).not.toHaveBeenCalled();
  });

  it('reintento interno Atlas: 2.º intento pasa por puerta y hace 0 POST si falla', async () => {
    vi.useFakeTimers(); vi.spyOn(ADAPTERS.atlas, 'quote').mockResolvedValue(0.08);
    let n = 0;
    const spy = spyA().mockImplementation(async () => {
      if (++n === 1) { disk.failSet = true; throw new HttpError(500, 'Upstream access denied', {}); }
      return imgOut('a2');
    });
    const p = runGeneration(makeMedia({ modelRef: ATLAS }).id).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(5500);
    expect(((await p) as Error).message).toMatch(/not sent/i);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.fails('reintento interno Atlas: ni sending durante sleep ni intent colgado si discarding bloquea retry #2', async () => {
    vi.useFakeTimers(); vi.spyOn(ADAPTERS.atlas, 'quote').mockResolvedValue(0.08);
    const spy = spyA().mockRejectedValue(new HttpError(500, 'Upstream access denied', {}));
    const g = makeMedia({ modelRef: ATLAS });
    const p = runGeneration(g.id).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(500);
    const sendingDuringSleep = genOf(g.id).sending;
    guard.discarding = true;
    await vi.advanceTimersByTimeAsync(5500); await p;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sendingDuringSleep).toBeUndefined();
    expect(genOf(g.id).sends?.some((s) => s.status === 'intent')).toBeFalsy();
  });

  it('plan multipaso: paso 2 bloqueado en 8 s -> 0 POST, paso 3 omitido, toast sin Retry suelto', async () => {
    let calls = 0;
    const spy = spyN().mockImplementation(async () => { if (++calls === 1) disk.failSet = true; return imgOut(`p${calls}`); });
    const steps = [mkStep('s1'), mkStep('s2', ['s1']), mkStep('s3', ['s2'])];
    putPlan('it_p1', 'p1', 'running', steps, { s1: 'pending', s2: 'pending', s3: 'pending' });
    const states: Record<string, string> = {};
    const res = await executeSteps(steps, { sessionId: sid(), planId: 'p1', workspace: 'chat', origin: 'agent', concurrency: 1, onState: (id, st) => { states[id] = st; } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(states).toMatchObject({ s1: 'done', s2: 'error', s3: 'skipped' });
    expect(res.skipped).toContain('s3');
    expect(toasts().find((t) => /not sent/i.test(t.text))?.action).toBeUndefined();
  });

  it('onGenerationCredit (always): 0 POST al sustituto si falla guardado', async () => {
    setupCatalog({ autoSwitch: 'always' }); vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    spyN().mockImplementationOnce(async () => { disk.failSet = true; throw new HttpError(402, 'Insufficient credits', {}); });
    const atlasSpy = spyA().mockResolvedValue(imgOut('atlas'));
    await expect(runGeneration(makeMedia().id)).rejects.toThrow(/not sent/i);
    expect(atlasSpy).not.toHaveBeenCalled();
  });

  it.fails('local gratis: NO debe bloquearse por fallo de guardado', async () => {
    const localSpy = vi.spyOn(ADAPTERS.local, 'generate').mockResolvedValue(imgOut('l', 0));
    disk.failSet = true;
    const g = makeMedia({ modelRef: LOCAL_IMAGE_REF });
    expect(await runGeneration(g.id)).toHaveLength(1);
    expect(localSpy).toHaveBeenCalledTimes(1);
    expect(genOf(g.id).status).toBe('done');
  });

  it.fails('carrera guard.discarding (idb.ts:284 fail + revertToDisk limpia): 0 POST sin IDB', async () => {
    disk.onSet = () => { guard.discarding = true; queueMicrotask(() => { guard.discarding = false; }); };
    const spy = spyN().mockResolvedValue(imgOut('leak'));
    const g = makeMedia();
    await expect(runGeneration(g.id)).rejects.toThrow(/not sent/i);
    expect(spy).not.toHaveBeenCalled();
    expect(savedGen(g.id)?.sends).toBeUndefined();
  });
});

describe('2. Recarga en cada punto', () => {
  it('antes del POST: error limpio sin lostJob, uncertain ni toast', async () => {
    const g = makeMedia(); await saveNow(); await resumeInterrupted();
    expect(genOf(g.id).status).toBe('error');
    expect(genOf(g.id).lostJob).toBeFalsy();
    expect(genOf(g.id).sends).toBeUndefined();
    expect(toasts()).toHaveLength(0);
  });

  it('tras aceptar sin id: lostJob + uncertain + toast', async () => {
    let release!: () => void;
    const inFlight = new Promise<void>((res) => { spyN().mockImplementationOnce(async () => { res(); await new Promise<void>((r) => { release = r; }); return imgOut(); }); });
    const g = makeMedia(); const p = runGeneration(g.id).catch(() => undefined);
    await inFlight;
    expect(savedGen(g.id)?.sends?.[0]?.status).toBe('intent');
    await reloadAndResume();
    expect(genOf(g.id)).toMatchObject({ status: 'error', lostJob: true, sending: undefined });
    expect(genOf(g.id).sends?.[0]?.status).toBe('uncertain');
    expect(toasts().some((t) => /may have been sent and charged/i.test(t.text))).toBe(true);
    release(); await p;
  });

  it('tras id: reanuda sin nuevo POST y entrega 1 vez con 1 gasto', async () => {
    let release!: () => void;
    const gotId = new Promise<void>((res) => {
      spyN().mockImplementationOnce(async (req) => {
        req.onRemoteJob(rj('j_r1')); await tick(10); res();
        await new Promise<void>((r) => { release = r; }); return imgOut('orig');
      });
    });
    const resumeSpy = spyR().mockResolvedValueOnce(imgOut('resumed'));
    const g = makeMedia(); const p = runGeneration(g.id).catch(() => undefined);
    await gotId; await reloadAndResume(); await running.get(g.id);
    expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(1);
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(genOf(g.id).status).toBe('done');
    expect(genOf(g.id).assetIds).toHaveLength(1);
    expect(useStore.getState().spendLog).toHaveLength(1);
    release(); await p;
  });

  it.fails('JobFailedError tras onRemoteJob: NO resucitar trabajo muerto desde sends', async () => {
    spyN().mockImplementationOnce(async (req) => { req.onRemoteJob(rj('dead_1')); throw new JobFailedError('failed'); });
    const resumeSpy = spyR().mockResolvedValue(imgOut('zombie'));
    const g = makeMedia();
    await expect(runGeneration(g.id)).rejects.toThrow(JobFailedError);
    expect(genOf(g.id).remoteJob).toBeUndefined();
    expect(activeRemoteJob(genOf(g.id))).toBeUndefined();
    expect(canRecheck(genOf(g.id))).toBe(false);
    await recheckGeneration(g.id);
    expect(resumeSpy).not.toHaveBeenCalled();
  });

  it.fails('recarga tras resultado en assetIds antes de finish() (checkDelivery): NO marcar error', async () => {
    let release!: () => void;
    const inCheck = new Promise<void>((res) => { disk.onBlobGet = async () => { res(); await new Promise<void>((r) => { release = r; }); }; });
    spyN().mockResolvedValueOnce(imgOut('paid'));
    const g = makeMedia(); const p = runGeneration(g.id).catch(() => undefined);
    await inCheck;
    expect(savedGen(g.id)?.assetIds).toHaveLength(1);
    await reloadAndResume();
    expect(genOf(g.id).status).toBe('done');
    expect(genOf(g.id).assetIds).toHaveLength(1);
    release(); await p;
  });

  it.fails('recarga a mitad de lote (3 items, id del 1.º): NO cerrar done con 1 de 3 y cobrar los 3', async () => {
    const g = makeMedia({ count: 3 });
    patchG(g.id, { status: 'running', estimate: { usd: 0.3, approximate: false }, remoteJob: rj('bj0'), sends: [{ id: 'r0', index: 0, status: 'sent', remoteJob: rj('bj0') }] });
    await saveNow();
    spyR().mockResolvedValueOnce(imgOut('one', undefined));
    await resumeInterrupted(); await running.get(g.id);
    expect(genOf(g.id).assetIds).toHaveLength(1);
    expect(genOf(g.id).status).not.toBe('done');
    expect(useStore.getState().spentUsd).toBeLessThan(0.25);
  });

  it.fails('local gratis: recarga en vuelo NO marca lostJob/uncertain ni toast de cobro', async () => {
    let release!: () => void;
    const rendering = new Promise<void>((res) => { vi.spyOn(ADAPTERS.local, 'generate').mockImplementationOnce(async () => { res(); await new Promise<void>((r) => { release = r; }); return imgOut('l', 0); }); });
    const g = makeMedia({ modelRef: LOCAL_IMAGE_REF }); const p = runGeneration(g.id).catch(() => undefined);
    await rendering; await reloadAndResume();
    expect(genOf(g.id).lostJob).toBeFalsy();
    expect(genOf(g.id).sends?.some((s) => s.status === 'uncertain')).toBeFalsy();
    expect(toasts().some((t) => /charged/i.test(t.text))).toBe(false);
    release(); await p;
  });

  it.fails('specialSends: cancelar tras enviar sin remoteJob NO deja sends[0] en intent', async () => {
    const started = new Promise<void>((res) => {
      vi.spyOn(ADAPTERS.nanogpt, 'transcribe').mockImplementationOnce(async (req) => {
        res(); await new Promise<void>((_ok, rej) => { req.signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))); });
        return { outputs: [], text: '' };
      });
    });
    const g = createGeneration({ sessionId: sid(), origin: 'op', kind: 'text', prompt: '', modelRef: TR, settings: defSet, inputs: { refs: [] }, op: { id: 'transcribe', sourceAssetId: 'au', params: { language: 'es' } } } as never);
    const p = runGeneration(g.id).catch(() => undefined);
    await started; cancelGeneration(g.id); await p;
    expect(genOf(g.id).status).toBe('canceled');
    expect(genOf(g.id).sends?.[0]?.status).not.toBe('intent');
  });
});

describe('3. Idempotencia: rehidratar 2–3 veces, crédito y assetIds previos', () => {
  it('rehidratar 3 veces (concurrente, en vuelo y post-fin): 1 resume, 1 gasto y 1 entrega', async () => {
    const g = makeMedia();
    patchG(g.id, { status: 'running', remoteJob: rj('j_3'), sends: [{ id: 'r0', index: 0, status: 'sent', remoteJob: rj('j_3') }] });
    await saveNow();
    let release!: () => void;
    const resumeSpy = spyR().mockImplementation(async () => { await new Promise<void>((r) => { release = r; }); return imgOut('once'); });
    const r1 = resumeInterrupted(), r2 = resumeInterrupted();
    await rehydrate();
    const r3 = resumeInterrupted();
    await tick(10); release();
    await Promise.all([r1, r2, r3]); await running.get(g.id);
    await rehydrate(); await resumeInterrupted();
    await rehydrate(); await resumeInterrupted();
    const st = useStore.getState();
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(st.spendLog).toHaveLength(1);
    expect(st.spentUsd).toBeCloseTo(0.1);
    expect(st.generations[g.id].assetIds).toHaveLength(1);
    expect(Object.values(st.assets).filter((a) => a.generationId === g.id)).toHaveLength(1);
  });

  it('followRemote con assetIds previos + doble rehidratación: sin duplicar gasto ni entrega', async () => {
    const g = makeMedia({ count: 2 });
    useStore.setState((s) => ({ assets: { ...s.assets, prev_0: { id: 'prev_0', kind: 'image', mime: 'image/png', width: 512, height: 512, sessionId: sid(), origin: 'generated', generationId: g.id, stored: true, favorite: false, createdAt: 1 } as never } }));
    patchG(g.id, { status: 'running', assetIds: ['prev_0'], remoteJob: rj('jp1'), sends: [{ id: 'r0', index: 0, status: 'done', remoteJob: rj('jp0') }, { id: 'r1', index: 1, status: 'sent', remoteJob: rj('jp1') }] });
    await saveNow();
    const resumeSpy = spyR().mockResolvedValue(imgOut('two'));
    await resumeInterrupted(); await running.get(g.id);
    await rehydrate(); await resumeInterrupted();
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(genOf(g.id).assetIds).toHaveLength(2);
    expect(genOf(g.id).assetIds[0]).toBe('prev_0');
    expect(new Set(genOf(g.id).assetIds).size).toBe(2);
    expect(useStore.getState().spendLog).toHaveLength(1);
  });

  it('reentrada por crédito limpia (always): 1 gasto y 1 entrega', async () => {
    setupCatalog({ autoSwitch: 'always' }); vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    spyN().mockRejectedValueOnce(new HttpError(402, 'Insufficient credits', {}));
    const atlasSpy = spyA().mockResolvedValueOnce(imgOut('sub', 0.08));
    expect(await runGeneration(makeMedia().id)).toHaveLength(1);
    expect(atlasSpy).toHaveBeenCalledTimes(1);
    expect(useStore.getState().spendLog).toHaveLength(1);
    expect(useStore.getState().spentUsd).toBeCloseTo(0.08);
  });

  it('reentrada por crédito bloqueada con remoteJob, lostJob o send uncertain', async () => {
    setupCatalog({ autoSwitch: 'always' }); vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    const atlasSpy = spyA().mockResolvedValue(imgOut('bad'));
    for (const patch of [{ remoteJob: rj('rj1') }, { lostJob: true }, { sends: [{ id: 'u1', index: 0, status: 'uncertain' as const }] }]) {
      const g = makeMedia(); patchG(g.id, { status: 'error', ...patch });
      const rerun = vi.fn(async () => undefined);
      expect(await onGenerationCredit(g.id, rerun)).toBe(false);
      expect(rerun).not.toHaveBeenCalled();
    }
    expect(atlasSpy).not.toHaveBeenCalled();
  });

  it.fails('execute() tras reentrada con fallo no-red: NO debe borrar lostJob previo (jobs.ts:346-347)', async () => {
    const g = makeMedia(); patchG(g.id, { lostJob: true });
    spyN().mockRejectedValueOnce(new Error('bad input'));
    await runGeneration(g.id).catch(() => undefined);
    expect(genOf(g.id).lostJob).toBe(true);
  });

  it.fails('onGenerationCredit: NO debe auto-reenviar con status=intent sin liquidar (credit.ts:164)', async () => {
    setupCatalog({ autoSwitch: 'always' }); vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    const g = makeMedia(); patchG(g.id, { status: 'error', sends: [{ id: 'req_open', index: 0, status: 'intent' }] });
    const rerun = vi.fn(async () => undefined);
    expect(await onGenerationCredit(g.id, rerun)).toBe(false);
    expect(rerun).not.toHaveBeenCalled();
  });
});

describe('4. Reenvío de un incierto', () => {
  const uGen = (extra?: Partial<Generation>): Generation => {
    const g = makeMedia();
    const p: Generation = { ...g, status: 'error', error: 'Interrupted.', lostJob: true, sends: [{ id: 'r0', index: 0, status: 'uncertain' }], estimate: { usd: 0.1, approximate: false }, ...extra };
    patchG(g.id, p); return p;
  };
  const btn = (h: HTMLElement, re: RegExp) => [...h.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''))!;

  it('GenerationRecovery (!over): exige confirmación explícita sin confirm(); Cancel deja todo igual', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm'), genSpy = spyN().mockResolvedValue(imgOut('ok'));
    const g = uGen();
    const snap = () => JSON.stringify({ g: Object.keys(useStore.getState().generations), u: useStore.getState().spentUsd, l: useStore.getState().spendLog });
    const before = snap(), host = mount(createElement(GenerationRecovery, { g }));
    act(() => btn(host, /Retry/).click());
    expect(confirmSpy).not.toHaveBeenCalled(); expect(genSpy).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/May have been charged/i);
    act(() => btn(host, /Cancel/).click());
    expect(genSpy).not.toHaveBeenCalled(); expect(snap()).toBe(before);
    act(() => btn(host, /Retry/).click());
    await act(async () => { btn(host, /Resend anyway/).click(); await tick(); });
    expect(confirmSpy).not.toHaveBeenCalled(); expect(genSpy).toHaveBeenCalledTimes(1);
  });

  it.fails('GenerationRecovery (over=true): Continue once NO salta confirmación (RecoveryActions.tsx:73-89)', async () => {
    setupCatalog({ budgetOn: true, budgetLimit: 0.05 });
    const genSpy = spyN().mockResolvedValue(imgOut('bypass'));
    const host = mount(createElement(GenerationRecovery, { g: uGen({ estimate: { usd: 0.5, approximate: false } }) }));
    await act(async () => { btn(host, /Continue once/).click(); await tick(); });
    expect(genSpy).not.toHaveBeenCalled(); expect(host.textContent).toMatch(/May have been charged/i);
  });

  it.fails('PlanRecoveryChips: paso incierto exige confirmación (RecoveryActions.tsx:19-50)', async () => {
    const genSpy = spyN().mockResolvedValue(imgOut('bypass'));
    const g = uGen({ planId: 'plan_u', stepId: 's1' });
    const item = putPlan('it_pu', 'plan_u', 'error', [mkStep('s1')], { s1: 'error' }, { s1: g.id });
    const host = mount(createElement(PlanRecoveryChips, { sessionId: sid(), item }));
    await act(async () => { btn(host, /Retry failed/).click(); await tick(); });
    expect(genSpy).not.toHaveBeenCalled(); expect(host.textContent).toMatch(/May have been charged/i);
  });
});

describe('5. Persistencia compatible (legado sin sends)', () => {
  it('hidrata y recupera generaciones legadas sin sends', async () => {
    const sId = sid(), st = useStore.getState();
    const base = { sessionId: sId, kind: 'image' as const, prompt: 'old', modelRef: NANO, modelName: 'Seed', provider: 'nanogpt' as const, settings: defSet, inputs: { refs: [] }, origin: 'composer' as const, status: 'running' as const, assetIds: [], estimate: { usd: 0.1, approximate: false } };
    disk.raw = JSON.stringify({ version: 1, state: { settings: st.settings, spentUsd: 0, spendLog: [], sessions: st.sessions, activeSessionId: sId, generations: { leg_s: { ...base, id: 'leg_s', sending: Date.now() - 5000, createdAt: 1 }, leg_r: { ...base, id: 'leg_r', remoteJob: rj('leg_j1'), createdAt: 2 } }, assets: st.assets, library: [], composer: { ...st.composer, editing: undefined }, ui: { workspace: 'chat' } } });
    spyR().mockResolvedValueOnce(imgOut('ok'));
    await rehydrate();
    expect(genOf('leg_s').sends).toBeUndefined(); expect(canRecheck(genOf('leg_r'))).toBe(true);
    await resumeInterrupted(); await running.get('leg_r');
    expect(genOf('leg_s')).toMatchObject({ status: 'error', lostJob: true, sending: undefined });
    expect(genOf('leg_r')).toMatchObject({ status: 'done' }); expect(genOf('leg_r').assetIds).toHaveLength(1);
  });
});

describe('6. Mensajes al usuario', () => {
  it('simple bloqueado antes del POST: «Nothing was charged» con 0 POST', async () => {
    disk.failSet = true; const spy = spyN().mockResolvedValue(imgOut()); const g = makeMedia();
    await expect(runGeneration(g.id)).rejects.toThrow(/Nothing was charged/);
    expect(spy).not.toHaveBeenCalled(); expect(genOf(g.id).error).toMatch(/Nothing was charged/);
    expect(toasts().some((t) => /Nothing was charged/.test(t.text))).toBe(true);
  });

  it.fails('lote: tras cobrar 1.º, si 2.º cae en 8 s NO afirmar «Nothing was charged» (jobs.ts:334-335)', async () => {
    let n = 0; spyN().mockImplementation(async () => { if (++n === 1) disk.failSet = true; return imgOut('p1'); });
    const g = makeMedia({ count: 2 }); await runGeneration(g.id).catch(() => undefined);
    expect(genOf(g.id).assetIds).toHaveLength(1);
    expect(genOf(g.id).error).not.toMatch(/Nothing was charged/i);
    expect(toasts().some((t) => /Nothing was charged/i.test(t.text))).toBe(false);
  });
});
