import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({
  raw: undefined as string | undefined,
  onSet: undefined as (() => Promise<void> | void) | undefined,
  putFail: false,
}));
const lock = vi.hoisted(() => ({ held: true }));

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' },
}));
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
        disk.raw = typeof raw === 'string' ? raw : raw.text();
        return 'ok';
      },
      del: async () => undefined,
    },
    cacheDb: { get: async () => undefined, set: async () => undefined },
    getAssetBlob: async () => new Blob(['audio-bytes'], { type: 'audio/mpeg' }),
    putAssetBlob: async () => { if (disk.putFail) throw new Error('QuotaExceededError'); },
    deleteAssetBlobs: async () => undefined,
  };
});
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  probeMedia: async () => ({ width: 512, height: 512 }),
}));
vi.mock('../src/engine/design/raster', async (orig) => ({
  ...(await orig<typeof import('../src/engine/design/raster')>()),
  flushRaster: async () => undefined,
  deleteBuffers: async () => undefined,
}));

import { guard } from '../src/lib/saveGuard';
import { HttpError } from '../src/lib/http';
import { useStore } from '../src/store/store';
import { useAlerts } from '../src/engine/alerts';
import { rewritePrompts } from '../src/engine/agent/planSettings';
import { forgetBalances, onAgentCredit } from '../src/engine/credit';
import { lockNodes, lockedNodes } from '../src/engine/flow/locks';
import { cancelGeneration, createGeneration, runGeneration } from '../src/engine/jobs';
import { controllers, purgeDiscarded, running } from '../src/engine/jobState';
import { ADAPTERS } from '../src/engine/providers/registry';
import type { Graph, ModelSummary, PlanFeedItem, PlanStep } from '../src/engine/types';
import { patchGeneration } from '../src/store/store';
import { mainThread } from './helpers/threads';

const NANO = 'nanogpt::seed';
const ATLAS = 'atlas::seed';
const TR = 'nanogpt::transcriber';
const defSet = { count: 1, advanced: {} };
const sid = () => useStore.getState().activeSessionId;
const genOf = (id: string) => useStore.getState().generations[id];
const imgOut = (tag = 'x', costUsd = 0.1) => ({
  outputs: [{ blob: new Blob([tag], { type: 'image/png' }), mime: 'image/png' }],
  costUsd,
});

function setupStore(opts?: {
  budgetOn?: boolean;
  budgetUsd?: number;
  spentUsd?: number;
  autoSwitch?: 'ask' | 'always' | 'never';
}) {
  const st = useStore.getState();
  const sId = st.activeSessionId;
  const mod = (ref: string, provider: 'nanogpt' | 'atlas', id: string, usd: number): ModelSummary =>
    ({ ref, provider, id, name: 'Seed', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd }] } }) as ModelSummary;
  const sch = (ref: string) => ({ ref, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' });
  const au = { id: 'au', kind: 'audio', mime: 'audio/mpeg', duration: 60, sessionId: sId, origin: 'upload', stored: true, favorite: false, createdAt: 1 } as never;
  useStore.setState({
    generations: {},
    tickets: {},
    quotes: {},
    spendLog: [],
    spentUsd: opts?.spentUsd ?? 0,
    ui: { ...st.ui, toasts: [] },
    assets: { au },
    settings: {
      ...st.settings,
      keys: { ...st.settings.keys, nanogpt: 'k-n', atlas: 'k-a', openrouter: 'k-o' },
      budgetOn: opts?.budgetOn ?? false,
      budgetUsd: opts?.budgetUsd ?? 25,
      budgetNoAsk: false,
      budgetAccepted: null,
      autoSwitchProvider: opts?.autoSwitch ?? 'ask',
      agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm-a' },
      mutedNotices: [],
    },
    catalog: {
      ...st.catalog,
      models: { [NANO]: mod(NANO, 'nanogpt', 'seed', 0.1), [ATLAS]: mod(ATLAS, 'atlas', 'seed', 0.08) },
      schemas: { [NANO]: sch(NANO), [ATLAS]: sch(ATLAS) },
      transcribers: {
        [TR]: { ref: TR, provider: 'nanogpt', name: 'Test STT', id: 'transcriber', usdPerMinute: 0.01, maxDirectBytes: 1_000_000, video: false, diarization: false },
      },
    } as never,
    sessions: {
      [sId]: {
        ...st.sessions[sId],
        noAskOverLimit: false,
        graph: { nodes: [], edges: [] },
        feed: [],
        agents: mainThread({ history: [], notes: [], questionRound: 0, busy: false }),
      },
    },
  });
}

function putPlan(item: PlanFeedItem) {
  const sId = sid();
  useStore.setState((s) => ({
    sessions: { ...s.sessions, [sId]: { ...s.sessions[sId], feed: [item] } },
  }));
}

beforeEach(() => {
  disk.raw = undefined;
  disk.onSet = undefined;
  disk.putFail = false;
  lock.held = true;
  guard.discarding = false;
  running.clear();
  controllers.clear();
  useAlerts.setState({ alerts: [] });
  forgetBalances();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new Error(`Unexpected fetch: ${url}`); }));
  setupStore();
});

afterEach(() => {
  disk.onSet = undefined;
  lock.held = true;
  guard.discarding = false;
  running.clear();
  controllers.clear();
  useAlerts.setState({ alerts: [] });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});


const FREE = 'nanogpt::free';
function addFree() {
  const st = useStore.getState();
  const m = { ref: FREE, provider: 'nanogpt', id: 'free', name: 'Free', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0 }] } } as never as ModelSummary;
  useStore.setState({ catalog: { ...st.catalog, models: { ...st.catalog.models, [FREE]: m }, schemas: { ...st.catalog.schemas, [FREE]: { ref: FREE, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' } } } as never });
}
const nodeGraph = (sId: string, genId: string) => {
  const graph = { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Image', prompt: 'node', modelRef: NANO, settings: defSet, generationId: genId, outputIndex: 0 } }], edges: [] } as unknown as Graph;
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sId]: { ...s.sessions[sId], graph } } }));
};
const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const hang = (req: { signal: AbortSignal }, onStart: () => void) => new Promise<never>((_r, rej) => { onStart(); req.signal.addEventListener('abort', () => rej(abortErr())); });

describe('1. aborto vs transporte (commitPaidSend / inTransport)', () => {
  it('aborto durante la espera de markSending (antes del POST): canceled, sin uncertain ni lostJob, 0 llamadas', async () => {
    const spy = vi.spyOn(ADAPTERS.nanogpt, 'generate').mockResolvedValue(imgOut());
    let enter!: () => void; let rel!: () => void;
    const entered = new Promise<void>((r) => { enter = r; });
    disk.onSet = () => { enter(); return new Promise<void>((r) => { rel = r; }); };
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'a', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    const p = runGeneration(g.id).catch((e) => e);
    await entered;
    cancelGeneration(g.id);
    disk.onSet = undefined; rel();
    await p;
    expect(spy).not.toHaveBeenCalled();
    expect(genOf(g.id).lostJob).toBeFalsy();
    expect(genOf(g.id).sends?.some((s) => s.status === 'uncertain' || s.status === 'intent') ?? false).toBe(false);
  });

  it('envio gratuito abortado en vuelo: no se marca uncertain ni lostJob (no es falso positivo)', async () => {
    addFree();
    let started!: () => void; const inFlight = new Promise<void>((r) => { started = r; });
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation((req) => hang(req, started));
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'free', modelRef: FREE, settings: defSet, inputs: { refs: [] } });
    const p = runGeneration(g.id).catch((e) => e);
    await inFlight; cancelGeneration(g.id); await p;
    expect(genOf(g.id).status).toBe('canceled');
    expect(genOf(g.id).lostJob).toBeFalsy();
  });

  it('adapter.retry: abortar durante la espera del reintento no marca uncertain (la peticion rechazada no cobro)', async () => {
    const spy = vi.spyOn(ADAPTERS.atlas, 'generate').mockRejectedValue(new Error('Upstream access denied'));
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'r', modelRef: ATLAS, settings: defSet, inputs: { refs: [] } });
    const p = runGeneration(g.id).catch((e) => e);
    await vi.waitFor(() => expect(genOf(g.id).statusText ?? '').toMatch(/trying again/));
    cancelGeneration(g.id); await p;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(genOf(g.id).lostJob).toBeFalsy();
    expect(genOf(g.id).sends?.some((s) => s.status === 'uncertain') ?? false).toBe(false);
  });

  it('adapter.retry: aborto en vuelo del SEGUNDO envio (tras reintento) si queda uncertain', async () => {
    let calls = 0; let started!: () => void; const second = new Promise<void>((r) => { started = r; });
    vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation((req) => {
      if (++calls === 1) return Promise.reject(new Error('Upstream access denied'));
      return hang(req, started);
    });
    // espera real: ATLAS_RETRY_MS; se acorta forzando el sleep con fake timers
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'r2', modelRef: ATLAS, settings: defSet, inputs: { refs: [] } });
      const p = runGeneration(g.id).catch((e) => e);
      await vi.advanceTimersByTimeAsync(70_000);
      await second;
      cancelGeneration(g.id); await p;
      expect(genOf(g.id).sends?.[0]?.status).toBe('uncertain');
      expect(genOf(g.id).lostJob).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  // Cobro perdido: el proveedor ya respondio (cobrado) y el fallo es local (guardar el blob). inTransport=false -> el intent se borra.
  it('proveedor sincrono devuelve salida y falla el guardado local (cuota IDB): el envio no puede quedar borrado/sin lostJob (Retry = doble cobro)', async () => {
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockResolvedValue(imgOut('paid', 0.1));
    disk.putFail = true;
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'quota', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    await runGeneration(g.id).catch(() => undefined);
    const cur = genOf(g.id);
    const traced = cur.lostJob === true || cur.sends?.some((s) => s.status === 'uncertain' || s.status === 'sent' || s.status === 'done') || useStore.getState().spentUsd > 0;
    expect(traced).toBe(true);
  });
});

describe('2. holdAttemptNode reentrante', () => {
  it('un llamador SIN lock propio no debe pasar como reentrante si OTRA ejecucion escribe el nodo (doble generacion sobre el mismo nodo)', async () => {
    setupStore({ autoSwitch: 'always' });
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient credits', {}));
    const atlasSpy = vi.spyOn(ADAPTERS.atlas, 'generate').mockResolvedValue(imgOut('atlas', 0.08));
    const sId = sid();
    const g = createGeneration({ sessionId: sId, origin: 'composer', kind: 'image', prompt: 'x', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    nodeGraph(sId, g.id);
    const release = lockNodes(sId, ['n1']); // otra ejecucion (p. ej. Run del nodo) escribe n1
    try { await runGeneration(g.id).catch(() => undefined); } finally { release(); }
    expect(atlasSpy).not.toHaveBeenCalled();
  });

  it('el propietario real (runGeneration de nodo sin lock previo) toma y libera el lock: no queda colgado', async () => {
    setupStore({ autoSwitch: 'always' });
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient credits', {}));
    vi.spyOn(ADAPTERS.atlas, 'generate').mockRejectedValue(new Error('boom')); // el sustituto falla
    const sId = sid();
    const g = createGeneration({ sessionId: sId, origin: 'node', stepId: 'n1', kind: 'image', prompt: 'n', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    nodeGraph(sId, g.id);
    await runGeneration(g.id).catch(() => undefined);
    expect(lockedNodes(sId).has('n1')).toBe(false);
  });

  it('reentrante bajo un lock del propio intento: no libera el lock ajeno ni lo duplica', async () => {
    setupStore({ autoSwitch: 'always' });
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient credits', {}));
    vi.spyOn(ADAPTERS.atlas, 'generate').mockResolvedValue(imgOut('atlas', 0.08));
    const sId = sid();
    const g = createGeneration({ sessionId: sId, origin: 'node', stepId: 'n1', kind: 'image', prompt: 'n', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    nodeGraph(sId, g.id);
    const release = lockNodes(sId, ['n1']);
    await runGeneration(g.id).catch(() => undefined);
    expect(lockedNodes(sId).has('n1')).toBe(true); // sigue del propietario
    release();
    expect(lockedNodes(sId).has('n1')).toBe(false);
  });
});

describe('3. confirmOverLimit en always: Continue once tardio', () => {
  async function overLimitAlways(origin: 'composer' | 'node' = 'composer') {
    setupStore({ budgetOn: true, budgetUsd: 0.12, spentUsd: 0, autoSwitch: 'always' });
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementationOnce(async () => { useStore.setState({ spentUsd: 0.15 }); throw new HttpError(402, 'Insufficient credits', {}); });
    let lockedDuring = false;
    const atlasSpy = vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => { lockedDuring = lockedNodes(sid()).has('n1'); return imgOut('atlas', 0.08); });
    const g = createGeneration({ sessionId: sid(), origin, ...(origin === 'node' ? { stepId: 'n1' } : {}), kind: 'image', prompt: 'o', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    if (origin === 'node') nodeGraph(sid(), g.id);
    await runGeneration(g.id).catch(() => undefined);
    const alert = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label === 'Continue once'));
    return { g, atlasSpy, alert, locked: () => lockedDuring };
  }

  it('sobre el limite: no envia; Continue once ejecuta exactamente una vez, con lock; un segundo clic no repite', async () => {
    const { g, atlasSpy, alert, locked } = await overLimitAlways('node');
    expect(atlasSpy).not.toHaveBeenCalled();
    expect(alert).toBeDefined();
    const go = alert!.actions!.find((x) => x.label === 'Continue once')!;
    // Delivery publishes done before the final save and node lock cleanup.
    let releaseFinalSave!: () => void;
    const finalSave = new Promise<void>((resolve) => { releaseFinalSave = resolve; });
    disk.onSet = () => genOf(g.id).status === 'done' ? finalSave : undefined;
    go.run(); go.run();
    const retryRun = running.get(g.id);
    try {
      await vi.waitFor(() => expect(genOf(g.id).status).toBe('done'));
    } finally {
      releaseFinalSave();
    }
    await retryRun;
    expect(atlasSpy).toHaveBeenCalledTimes(1);
    expect(locked()).toBe(true);
    expect(lockedNodes(sid()).has('n1')).toBe(false);
  });

  it('sesion cambiada (la tarjeta ya se reintento): Continue once no envia nada', async () => {
    const { g, atlasSpy, alert } = await overLimitAlways();
    patchGeneration(g.id, { status: 'done' });
    alert!.actions!.find((x) => x.label === 'Continue once')!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(atlasSpy).not.toHaveBeenCalled();
  });

  it('Cancel no envia y el 402 deja la generacion en error (no done)', async () => {
    const { g, atlasSpy, alert } = await overLimitAlways();
    alert!.actions!.find((x) => x.label === 'Cancel')!.run();
    expect(atlasSpy).not.toHaveBeenCalled();
    expect(genOf(g.id).status).toBe('error');
  });

  it('presupuesto sin limite (budgetOn=false): sustituye al instante, una sola vez', async () => {
    setupStore({ autoSwitch: 'always' });
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient credits', {}));
    const atlasSpy = vi.spyOn(ADAPTERS.atlas, 'generate').mockResolvedValue(imgOut('atlas', 0.08));
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'ok', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    await runGeneration(g.id);
    expect(atlasSpy).toHaveBeenCalledTimes(1);
  });
});

describe('4. purgeDiscarded', () => {
  const finished = (sends: never[]) => {
    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'p', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    patchGeneration(g.id, { status: 'done', discard: true, sends } as never);
    return g.id;
  };
  it('discard sin rastro: se purga', () => {
    const id = finished([]);
    purgeDiscarded(id);
    expect(genOf(id)).toBeUndefined();
  });
  it('una generacion ENTREGADA (done) de una sesion borrada con un uncertain historico ya resuelto por un reintento se purga (no se acumula para siempre)', () => {
    const id = finished([{ id: 'r1', index: 0, status: 'uncertain' }, { id: 'r2', index: 0, status: 'done' }] as never);
    purgeDiscarded(id);
    expect(genOf(id)).toBeUndefined();
  });
  it('error con uncertain abierto se conserva (rastro de cobro)', () => {
    const id = finished([]);
    patchGeneration(id, { status: 'error', lostJob: true, sends: [{ id: 'r1', index: 0, status: 'uncertain' }] } as never);
    purgeDiscarded(id);
    expect(genOf(id)).toBeDefined();
  });
});

describe('5. llmCallEstimate / presupuesto agotado', () => {
  const llm = (id: string, name: string, inputPrice?: number, outputPrice?: number) => ({ id, name, tools: true, vision: true, inputPrice, outputPrice }) as never;
  const plan = () => {
    const step: PlanStep = { id: 's1', kind: 'image', title: 'Shot', prompt: 'a bike', modelRef: NANO, settings: defSet, refs: [] };
    putPlan({ id: 'it_rw', type: 'plan', style: 'auto', status: 'awaiting', workspace: 'chat', plan: { id: 'p_rw', title: 'R', summary: '', workspace: 'chat', style: '', steps: [step], subjects: [], adjustments: [] }, stepStates: {}, stepGenerations: {}, createdAt: 1 } as never as PlanFeedItem);
  };
  const sse = 'data: {"choices":[{"delta":{"content":"{\\"s1\\":\\"rewritten\\"}"}}]}\n\ndata: [DONE]\n\n';
  const setLlm = (models: never[]) => { const st = useStore.getState(); useStore.setState({ catalog: { ...st.catalog, llm: { ...st.catalog.llm, nanogpt: models } } }); };

  it('modelo LLM gratuito (0/0) con presupuesto agotado NO debe bloquear rewritePrompts (coste 0)', async () => {
    setupStore({ budgetOn: true, budgetUsd: 0.01, spentUsd: 0.02 });
    setLlm([llm('m-a', 'Free', 0, 0)]);
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    plan();
    await rewritePrompts(sid(), 'it_rw', 'image');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('modelo gratuito con presupuesto NO agotado (queda saldo): rewritePrompts llama', async () => {
    setupStore({ budgetOn: true, budgetUsd: 1, spentUsd: 0.5 });
    setLlm([llm('m-a', 'Free', 0, 0)]);
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    plan();
    await rewritePrompts(sid(), 'it_rw', 'image');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('modelo desconocido (fuera del catalogo) con presupuesto agotado: bloquea (precio no comprobable)', async () => {
    setupStore({ budgetOn: true, budgetUsd: 0.01, spentUsd: 0.02 });
    setLlm([]);
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    plan();
    await rewritePrompts(sid(), 'it_rw', 'image');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('onAgentCredit always: sustituto gratuito (0/0) con presupuesto agotado debe cambiar de modelo (no cuesta nada)', async () => {
    setupStore({ budgetOn: true, budgetUsd: 0.01, spentUsd: 0.02, autoSwitch: 'always' });
    const st = useStore.getState();
    useStore.setState({ catalog: { ...st.catalog, llm: { ...st.catalog.llm, nanogpt: [llm('m-a', 'Model A', 0, 0)], openrouter: [llm('m-a2', 'Model A', 0, 0)] } } });
    vi.spyOn(ADAPTERS.openrouter, 'balance').mockResolvedValue(10);
    expect(await onAgentCredit(sid())).toBe(true);
  });
});
