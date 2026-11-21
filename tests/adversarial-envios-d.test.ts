// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({
  raw: undefined as string | undefined, failSet: false,
  onSet: undefined as (() => Promise<void> | void) | undefined,
  onBlobGet: undefined as (() => Promise<void> | void) | undefined,
}));
const lock = vi.hoisted(() => ({ held: true }));

vi.mock('../src/lib/writerLock', async (orig) => ({ ...(await orig<typeof import('../src/lib/writerLock')>()), holdsWriterLock: () => lock.held, mayStartWork: () => lock.held }));
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
    getAssetBlob: async () => { if (disk.onBlobGet) await disk.onBlobGet(); return new Blob(['media'], { type: 'video/mp4' }); },
    putAssetBlob: async () => undefined,
    deleteAssetBlobs: async () => undefined,
  };
});
vi.mock('../src/lib/media', async (orig) => ({ ...(await orig<typeof import('../src/lib/media')>()), probeMedia: async () => ({ width: 512, height: 512 }) }));
vi.mock('../src/engine/design/raster', () => ({ flushRaster: async () => undefined }));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { guard } from '../src/lib/saveGuard';
import { HttpError, NetworkError } from '../src/lib/http';
import { saveNow, useStore } from '../src/store/store';
import { RECRAFT_STYLE_REF } from '../src/engine/catalog';
import { forgetBalances } from '../src/engine/credit';
import { cancelGeneration, createGeneration, recheckGeneration, resumeInterrupted, retryGeneration, runGeneration } from '../src/engine/jobs';
import { controllers, running } from '../src/engine/jobState';
import { ADAPTERS } from '../src/engine/providers/registry';
import { periodStart, summarizeSpend } from '../src/engine/spending';
import type { Generation, ModelSummary } from '../src/engine/types';
import { SpendingPanel } from '../src/components/shell/SpendingPanel';
import { mainThread } from './helpers/threads';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NANO = 'nanogpt::seed', NANO_V = 'nanogpt::vid', ATLAS = 'atlas::seed', TR = 'nanogpt::transcriber';
const sid = () => useStore.getState().activeSessionId;
const genOf = (id: string) => useStore.getState().generations[id];
const spent = () => useStore.getState().spentUsd;
const logLen = () => useStore.getState().spendLog.length;
const patchG = (id: string, patch: Partial<Generation>) => useStore.setState((s) => ({ generations: { ...s.generations, [id]: { ...s.generations[id], ...patch } } }));
const rj = (id: string, provider: 'nanogpt' | 'atlas' | 'fal' = 'nanogpt') => ({ provider, id, meta: {} });
const imgOut = (tag = 'x', costUsd: number | undefined = 0.1) => ({ outputs: [{ blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png' }], costUsd });
const vidOut = (tag = 'v', costUsd: number | undefined = 0.5) => ({ outputs: [{ blob: new Blob([tag], { type: 'video/mp4' }), mime: 'video/mp4' }], costUsd });
const reloadFromDisk = async () => {
  running.clear(); controllers.clear();
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

function setupStore(extra?: { budgetOn?: boolean; budgetUsd?: number; autoSwitch?: 'ask' | 'always' }) {
  const st = useStore.getState(), sId = st.activeSessionId;
  const mod = (ref: string, provider: 'nanogpt' | 'atlas', id: string, name: string, usd: number, kind: 'image' | 'video' = 'image'): ModelSummary =>
    ({ ref, provider, id, name, kind, acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd }] } } as ModelSummary);
  const sch = (ref: string) => ({ ref, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' });
  const mkA = (id: string, kind: 'image' | 'audio', mime: string, x: object) => ({ id, kind, mime, sessionId: sId, origin: 'upload', stored: true, favorite: false, createdAt: 1, ...x }) as never;
  useStore.setState({
    generations: {}, quotes: {}, spendLog: [], spentUsd: 0, ui: { ...st.ui, toasts: [] },
    assets: { a1: mkA('a1', 'image', 'image/png', { width: 512, height: 512 }), au: mkA('au', 'audio', 'audio/mpeg', { duration: 10 }) },
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k-n', atlas: 'k-a', fal: 'k-f' }, budgetOn: extra?.budgetOn ?? false, budgetUsd: extra?.budgetUsd ?? 25, autoSwitchProvider: extra?.autoSwitch ?? 'ask', mutedNotices: [] },
    catalog: {
      ...st.catalog,
      models: { [NANO]: mod(NANO, 'nanogpt', 'seed', 'Seed', 0.1), [NANO_V]: mod(NANO_V, 'nanogpt', 'vid', 'Vid', 0.5, 'video'), [ATLAS]: mod(ATLAS, 'atlas', 'seed', 'Seed', 0.08) },
      schemas: { [NANO]: sch(NANO), [NANO_V]: sch(NANO_V), [ATLAS]: sch(ATLAS) },
      transcribers: { [TR]: { ref: TR, provider: 'nanogpt', name: 'Test STT', id: 'transcriber', usdPerMinute: 0.01, maxDirectBytes: 1_000_000, video: false, diarization: false } },
    } as never,
    sessions: { ...st.sessions, [sId]: { ...st.sessions[sId], feed: [], agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }) } },
  });
}

const make = (count: number, modelRef = NANO, kind: 'image' | 'video' = 'image', extra?: Record<string, unknown>) =>
  createGeneration({ sessionId: sid(), origin: 'composer', kind, prompt: 'tanda-d', modelRef, settings: { count, advanced: {}, ...(extra ?? {}) }, inputs: { refs: [] } });

beforeEach(() => {
  Object.assign(disk, { raw: undefined, failSet: false, onSet: undefined, onBlobGet: undefined });
  lock.held = true; guard.discarding = false;
  running.clear(); controllers.clear(); forgetBalances();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new Error(`Unexpected fetch: ${url}`); }));
  setupStore();
});

afterEach(() => {
  if (mountedRoot) { act(() => mountedRoot!.unmount()); mountedRoot = null; }
  running.clear(); controllers.clear();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('1. Doble asiento o asiento perdido (rutas críticas)', () => {
  it('CRÍTICO: recoverThenFollow + recarga en checkDelivery cobra DOBLE ($1.00 en vez de $0.50) y duplica assets', async () => {
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValueOnce(new NetworkError('drop'));
    const g = make(1, NANO_V, 'video', { audio: true });
    await expect(runGeneration(g.id)).rejects.toThrow(NetworkError);
    expect(genOf(g.id).lostJob).toBe(true);
    expect(genOf(g.id).sends?.[0]?.status).toBe('uncertain');

    let release!: () => void;
    let calls = 0;
    const inCheck = new Promise<void>((res) => {
      disk.onBlobGet = async () => {
        if (++calls === 1) { res(); await new Promise<void>((r) => { release = r; }); }
      };
    });
    vi.spyOn(ADAPTERS.nanogpt, 'recover').mockResolvedValueOnce(rj('j_rec'));
    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValue(vidOut('v1', 0.5));

    const p = recheckGeneration(g.id);
    await inCheck;
    await saveNow(); // estado intermedio persistido durante checkDelivery
    await reloadFromDisk();
    await running.get(g.id);
    release();
    await p;

    expect(genOf(g.id).status).toBe('done');
    expect(spent()).toBeCloseTo(0.5);
    expect(logLen()).toBe(1);
    expect(genOf(g.id).actualUsd).toBeCloseTo(0.5);
    expect(genOf(g.id).assetIds).toHaveLength(1);
    expect(genOf(g.id).sends?.some((s) => s.status === 'uncertain')).toBe(false);
  });

  it('CRÍTICO: quote=$0 en 1.er ítem con costUsd real ($0.10) + 2.º ítem falla → pierde el cobro ($0)', async () => {
    vi.spyOn(ADAPTERS.atlas, 'quote').mockResolvedValue(0);
    let n = 0;
    vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => {
      if (++n === 2) throw new HttpError(500, 'boom', {});
      return imgOut('a1', 0.1);
    });
    const g = make(2, ATLAS);
    await expect(runGeneration(g.id)).rejects.toThrow();
    expect(genOf(g.id).assetIds).toHaveLength(1);
    expect(spent()).toBeCloseTo(0.1);
    expect(logLen()).toBe(1);
  });

  it('CRÍTICO: lote mixto (1.º quote=$0 con costUsd=$0.10, 2.º quote=$0.10 con costUsd=$0.10) → finish() pierde $0.10', async () => {
    useStore.setState((s) => ({ catalog: { ...s.catalog, schemas: { ...s.catalog.schemas, [ATLAS]: { ...s.catalog.schemas[ATLAS], params: [{ key: 'seed', role: 'seed', type: 'integer' }] } } } as never }));
    const g = make(2, ATLAS);
    vi.spyOn(ADAPTERS.atlas, 'quote').mockImplementation(async (_m, _sc, st) => (st.seed === g.settings.seed ? 0 : 0.1));
    vi.spyOn(ADAPTERS.atlas, 'generate').mockResolvedValue(imgOut('ok', 0.1));
    await runGeneration(g.id);
    expect(genOf(g.id).status).toBe('done');
    expect(genOf(g.id).assetIds).toHaveLength(2);
    expect(spent()).toBeCloseTo(0.2);
    expect(genOf(g.id).actualUsd).toBeCloseTo(0.2);
  });

  it('ALTO: followRemote normal + recarga en checkDelivery deja generación cobrada ($0.10) zombi en running sin assets', async () => {
    const g = make(1, NANO_V, 'video', { audio: true });
    patchG(g.id, { status: 'running', remoteJob: rj('j_v1'), sends: [{ id: 'r0', index: 0, status: 'sent', remoteJob: rj('j_v1') }] });
    await saveNow();

    let release!: () => void;
    let blobCalls = 0;
    const inCheck = new Promise<void>((res) => {
      disk.onBlobGet = async () => {
        if (++blobCalls === 1) { res(); await new Promise<void>((r) => { release = r; }); }
      };
    });
    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValue(vidOut('v1', 0.5));

    const p = resumeInterrupted();
    await inCheck;
    await saveNow(); // deliverSend ya cobró $0.50 y marcó sends[0]=done, pero finish() aún no corrió
    await reloadFromDisk();
    await running.get(g.id);
    release();
    await p;

    expect(spent()).toBeCloseTo(0.5);
    expect(genOf(g.id).status).toBe('done');
    expect(genOf(g.id).assetIds).toHaveLength(1);
  });

  it('ALTO: estimate=$0 pero quote=$0.10 (pagado) + NetworkError borra intent pagado y omite lostJob', async () => {
    vi.spyOn(ADAPTERS.atlas, 'quote').mockResolvedValue(0.1);
    vi.spyOn(ADAPTERS.atlas, 'generate').mockRejectedValueOnce(new NetworkError('lost'));
    const g = make(1, ATLAS);
    patchG(g.id, { estimate: { usd: 0, approximate: true } });
    await expect(runGeneration(g.id)).rejects.toThrow(NetworkError);
    expect(genOf(g.id).lostJob).toBe(true);
    expect(genOf(g.id).sends?.[0]?.status).toBe('uncertain');
  });

  it('ALTO: estimate=$0 pero quote=$0.10 (pagado) + recarga en vuelo borra intent pagado y oculta aviso de cobro', async () => {
    vi.spyOn(ADAPTERS.atlas, 'quote').mockResolvedValue(0.1);
    let release!: () => void;
    const inFlight = new Promise<void>((res) => {
      vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementationOnce(async () => { res(); await new Promise<void>((r) => { release = r; }); return imgOut('ok', 0.1); });
    });
    const g = make(1, ATLAS);
    patchG(g.id, { estimate: { usd: 0, approximate: true } });
    const p = runGeneration(g.id).catch(() => undefined);
    await inFlight;
    await reloadFromDisk();
    // What the reload leaves (a real reload ends the old run): the paid request is uncertain and flagged.
    expect(genOf(g.id).lostJob).toBe(true);
    expect(genOf(g.id).sends?.[0]?.status).toBe('uncertain');
    // The test's old run still lives in memory: if it delivers after all, that request is booked once.
    release(); await p;
    expect(spent()).toBeCloseTo(0.1);
    expect(logLen()).toBe(1);
  });

  it('MEDIO: lote sin precio (estimate null), ítem 1 sin coste + ítem 2 $0.30 > límite $0.20 → noteExcess no avisa', async () => {
    setupStore({ budgetOn: true, budgetUsd: 0.2 });
    useStore.setState((s) => ({ catalog: { ...s.catalog, models: { ...s.catalog.models, [NANO]: { ...s.catalog.models[NANO], price: undefined } } } as never }));
    let n = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => ({ ...imgOut(`m${++n}`), costUsd: n === 2 ? 0.3 : undefined }));
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'unpriced', modelRef: NANO, settings: { count: 2, advanced: {} }, inputs: { refs: [] }, estimate: { usd: 0, approximate: true } });
    patchG(g.id, { estimate: { usd: null, approximate: true }, retryBaseEstimate: { usd: null, approximate: true } });
    await runGeneration(g.id);
    expect(spent()).toBeCloseTo(0.3);
    const notices = useStore.getState().sessions[sid()].feed.filter((f) => f.type === 'notice' && f.overLimitFor?.gen === g.id);
    expect(notices).toHaveLength(1);
  });
});

describe('2. Rutas verificadas que sí cuadran el gasto', () => {
  it('onGenerationCredit (always) en lote parcial real: 1.º NanoGPT ($0.10) + 2.º HTTP 402 → Atlas ($0.08) = $0.18 una vez', async () => {
    setupStore({ autoSwitch: 'always' });
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    vi.spyOn(ADAPTERS.atlas, 'quote').mockResolvedValue(0.08);
    let n = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => {
      if (++n === 1) return imgOut('n1', 0.1);
      throw new HttpError(402, 'Insufficient credits', {});
    });
    vi.spyOn(ADAPTERS.atlas, 'generate').mockResolvedValueOnce(imgOut('a2', 0.08));
    const g = make(2, NANO);
    await runGeneration(g.id);
    expect(genOf(g.id).status).toBe('done');
    expect(genOf(g.id).assetIds).toHaveLength(2);
    expect(spent()).toBeCloseTo(0.18);
    expect(genOf(g.id).actualUsd).toBeCloseTo(0.18);
    expect(useStore.getState().spendLog.map((e) => [e.provider, e.usd])).toEqual([['nanogpt', 0.1], ['atlas', 0.08]]);
    await reloadFromDisk(); await reloadFromDisk();
    expect(spent()).toBeCloseTo(0.18);
    expect(logLen()).toBe(2);
  });

  it('retry interno Atlas en 2.º ítem tras cobrar 1.º + abort durante sleep: 1 solo asiento ($0.08)', async () => {
    vi.useFakeTimers();
    vi.spyOn(ADAPTERS.atlas, 'quote').mockResolvedValue(0.08);
    let n = 0;
    vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => {
      if (++n === 1) return imgOut('a1', 0.08);
      throw new HttpError(500, 'Upstream access denied', {});
    });
    const g = make(2, ATLAS);
    const p = runGeneration(g.id).catch((e) => e);
    await vi.advanceTimersByTimeAsync(500);
    cancelGeneration(g.id);
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(genOf(g.id).status).toBe('canceled');
    expect(spent()).toBeCloseTo(0.08);
    expect(logLen()).toBe(1);
    await reloadFromDisk();
    expect(spent()).toBeCloseTo(0.08);
    expect(logLen()).toBe(1);
  });

  it('specialSends (transcribe, createVoice, createStyle) con remoteJob + recarga doble: 1 asiento exacto cada uno', async () => {
    vi.spyOn(ADAPTERS.nanogpt, 'transcribe').mockImplementationOnce(async (opts) => { opts.onRemoteJob?.(rj('jt')); return new Promise(() => undefined); });
    vi.spyOn(ADAPTERS.fal, 'createVoice').mockResolvedValueOnce({ outputs: [], text: 'vc_1', costUsd: 0.05 });
    vi.spyOn(ADAPTERS.fal, 'createStyle').mockResolvedValueOnce({ outputs: [], text: 'sty_1', costUsd: 0.04 });
    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValueOnce({ outputs: [], text: 'hola', costUsd: 0.02 });

    const gTr = createGeneration({ sessionId: sid(), origin: 'op', kind: 'text', prompt: '', modelRef: TR, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, op: { id: 'transcribe', sourceAssetId: 'au', params: { language: 'es' } } } as never);
    void runGeneration(gTr.id).catch(() => undefined);
    await vi.waitFor(() => expect(disk.raw ?? '').toContain('"jt"'));
    await reloadFromDisk();
    await running.get(gTr.id);
    await reloadFromDisk();

    const gV = createGeneration({ sessionId: sid(), origin: 'op', kind: 'text', prompt: '', modelRef: 'fal::kling-voice', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, op: { id: 'create_voice', sourceAssetId: 'au', params: {} } } as never);
    const gS = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'text', prompt: 'style', modelRef: RECRAFT_STYLE_REF, settings: { count: 1, advanced: {} }, inputs: { refs: ['a1'] } });
    await runGeneration(gV.id);
    await runGeneration(gS.id);
    await reloadFromDisk();

    expect(genOf(gTr.id).status).toBe('done');
    expect(genOf(gV.id).status).toBe('done');
    expect(genOf(gS.id).status).toBe('done');
    expect(spent()).toBeCloseTo(0.11);
    expect(logLen()).toBe(3);
  });

  it('retryGeneration tras lote parcial (1/2 entregado): suma $0.10 + $0.10 = $0.20 sin doble asiento', async () => {
    let n = 0;
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => {
      if (++n === 2) throw new HttpError(500, 'boom', {});
      return imgOut(`i${n}`, 0.1);
    });
    const g1 = make(2, NANO);
    await expect(runGeneration(g1.id)).rejects.toThrow();
    expect(spent()).toBeCloseTo(0.1);
    const ids = await retryGeneration(g1.id);
    expect(ids).toHaveLength(2);
    expect(spent()).toBeCloseTo(0.2);
    expect(logLen()).toBe(2);
    await reloadFromDisk();
    expect(spent()).toBeCloseTo(0.2);
    expect(logLen()).toBe(2);
  });

  it('vista de Gasto y summarizeSpend con 1 entrada por solicitud en lote de 3: totales, filtros y render íntegros', async () => {
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockResolvedValue(imgOut('ok', 0.1));
    const g = make(3, NANO);
    await runGeneration(g.id);
    expect(spent()).toBeCloseTo(0.3);
    expect(logLen()).toBe(3);
    const sum = summarizeSpend(useStore.getState().spendLog, periodStart('today'));
    expect(sum.total).toBeCloseTo(0.3);
    expect(sum.media).toBeCloseTo(0.3);
    expect(sum.count).toBe(3);
    expect(sum.byModel[0]).toMatchObject({ key: NANO, count: 3 });
    expect(sum.byModel[0].usd).toBeCloseTo(0.3);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = mount(createElement(SpendingPanel));
    expect(host.textContent).toContain('$0.30');
    expect(host.textContent).toContain('3 charges');
    expect(host.textContent).not.toContain('Spending from before itemized tracking');
    expect(errSpy).not.toHaveBeenCalled();
  });
});
