import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({
  raw: undefined as string | undefined,
  onSet: undefined as (() => Promise<void> | void) | undefined,
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
    putAssetBlob: async () => undefined,
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
import { HttpError, NetworkError } from '../src/lib/http';
import { useStore } from '../src/store/store';
import { deleteSession } from '../src/engine/actions';
import { useAlerts } from '../src/engine/alerts';
import { rewritePrompts } from '../src/engine/agent/planSettings';
import { forgetBalances, onAgentCredit } from '../src/engine/credit';
import { runNodes } from '../src/engine/flow/actions';
import { lockedNodes } from '../src/engine/flow/locks';
import { cancelGeneration, createGeneration, runGeneration } from '../src/engine/jobs';
import { controllers, requestEstimate, running } from '../src/engine/jobState';
import { costAuthorization } from '../src/engine/priceAuthorization';
import { ADAPTERS } from '../src/engine/providers/registry';
import type { Graph, ModelSummary, PlanFeedItem, PlanStep } from '../src/engine/types';
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
const rj = (id: string) => ({ provider: 'nanogpt' as const, id, meta: {} });

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

describe('1. specialSends (transcribe) tras await markSending', () => {
  it.fails('plan revocado durante la espera de markSending -> 0 llamadas al adaptador y rollback de sends', async () => {
    const sId = sid();
    const step = { id: 's_tr', kind: 'op', op: 'transcribe', title: 'Transcribe', prompt: '', modelRef: TR, settings: defSet, refs: [] } as never as PlanStep;
    const gSpec = {
      sessionId: sId,
      origin: 'agent' as const,
      kind: 'text' as const,
      prompt: '',
      modelRef: TR,
      settings: defSet,
      inputs: { refs: [] },
      op: { id: 'transcribe' as const, sourceAssetId: 'au', params: { language: 'es' } },
      planId: 'p_tr',
      stepId: 's_tr',
    };
    const auth = costAuthorization(TR, defSet, requestEstimate(gSpec));
    putPlan({
      id: 'it_tr',
      type: 'plan',
      status: 'running',
      workspace: 'chat',
      plan: { id: 'p_tr', title: 'Transcribe', summary: '', workspace: 'chat', steps: [step] },
      stepStates: { s_tr: 'running' },
      stepGenerations: {},
      stepAuthorizations: { s_tr: auth },
      createdAt: 1,
    } as never as PlanFeedItem);

    const g = createGeneration(gSpec);
    const transcribeSpy = vi.spyOn(ADAPTERS.nanogpt, 'transcribe').mockResolvedValue({ outputs: [], text: 'hola', costUsd: 0.01 });

    let releaseSet!: () => void;
    let enteredSet!: () => void;
    const setStarted = new Promise<void>((r) => { enteredSet = r; });
    disk.onSet = () => {
      enteredSet();
      return new Promise<void>((r) => { releaseSet = r; });
    };

    const runPromise = runGeneration(g.id);
    await setStarted;
    // Plan revocado del feed mientras markSending espera a IndexedDB
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sId]: { ...s.sessions[sId], feed: [] } } }));
    disk.onSet = undefined;
    releaseSet();

    await expect(runPromise).rejects.toThrow(/no longer in the chat/i);
    expect(transcribeSpy).not.toHaveBeenCalled();
    expect(genOf(g.id).sends).toBeUndefined();
    expect(genOf(g.id).sending).toBeUndefined();
  });
});

describe('2. Proveedor síncrono sin id: abortar durante el transporte', () => {
  it.fails('abortar durante POST síncrono marca sends[0]=uncertain y lostJob=true', async () => {
    let posted!: () => void;
    const inFlight = new Promise<void>((r) => { posted = r; });
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      posted();
      init?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')));
    })));

    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'sync abort', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    const runPromise = runGeneration(g.id);
    await inFlight;
    cancelGeneration(g.id);

    await expect(runPromise).rejects.toThrow(/canceled/i);
    expect(genOf(g.id).sends?.[0]?.status).toBe('uncertain');
    expect(genOf(g.id).lostJob).toBe(true);
  });
});

describe('3. purgeDiscarded en generación en error con rastro pendiente', () => {
  it.fails('conserva generación en error con remoteJob activo tras borrar la sesión', async () => {
    const sId = sid();
    let release!: () => void;
    const gotJob = new Promise<void>((res) => {
      vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementationOnce(async (req) => {
        req.onRemoteJob(rj('j_active'));
        res();
        await new Promise<void>((r) => { release = r; });
        throw new NetworkError('connection dropped');
      });
    });

    const g = createGeneration({ sessionId: sId, origin: 'composer', kind: 'image', prompt: 'keep job', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    const runPromise = runGeneration(g.id).catch(() => undefined);
    await gotJob;
    deleteSession(sId);
    release();
    await runPromise;

    expect(genOf(g.id)).toBeDefined();
    expect(genOf(g.id)?.remoteJob?.id).toBe('j_active');
  });

  it.fails('conserva generación en error con uncertain/lostJob tras borrar la sesión', async () => {
    const sId = sid();
    let release!: () => void;
    const inFlight = new Promise<void>((res) => {
      vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementationOnce(async () => {
        res();
        await new Promise<void>((r) => { release = r; });
        throw new NetworkError('connection dropped');
      });
    });

    const g = createGeneration({ sessionId: sId, origin: 'composer', kind: 'image', prompt: 'keep uncertain', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    const runPromise = runGeneration(g.id).catch(() => undefined);
    await inFlight;
    deleteSession(sId);
    release();
    await runPromise;

    expect(genOf(g.id)).toBeDefined();
    expect(genOf(g.id)?.lostJob).toBe(true);
    expect(genOf(g.id)?.sends?.[0]?.status).toBe('uncertain');
  });
});

describe('4. rewritePrompts con presupuesto agotado', () => {
  it.fails('no envía POST a /chat/completions cuando budgetOn=true y spentUsd > budgetUsd', async () => {
    setupStore({ budgetOn: true, budgetUsd: 0.01, spentUsd: 0.02 });
    const sse = 'data: {"choices":[{"delta":{"content":"{\\"s1\\":\\"rewritten\\"}"}}]}\n\ndata: [DONE]\n\n';
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);

    const step: PlanStep = { id: 's1', kind: 'image', title: 'Shot 1', prompt: 'a red bicycle', modelRef: NANO, settings: defSet, refs: [] };
    putPlan({
      id: 'it_rw',
      type: 'plan',
      style: 'auto',
      status: 'awaiting',
      workspace: 'chat',
      plan: { id: 'p_rw', title: 'Rewrite', summary: '', workspace: 'chat', style: '', steps: [step], subjects: [], adjustments: [] },
      stepStates: {},
      stepGenerations: {},
      createdAt: 1,
    } as never as PlanFeedItem);

    await rewritePrompts(sid(), 'it_rw', 'image');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('5. onGenerationCredit en modo always', () => {
  it.fails('frena la sustitución tras 402 cuando el presupuesto ya está agotado (overLimit)', async () => {
    setupStore({ budgetOn: true, budgetUsd: 0.12, spentUsd: 0, autoSwitch: 'always' });
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementationOnce(async () => {
      // Otro trabajo agota el presupuesto antes de que llegue el 402
      useStore.setState({ spentUsd: 0.15 });
      throw new HttpError(402, 'Insufficient credits', {});
    });
    const atlasSpy = vi.spyOn(ADAPTERS.atlas, 'generate').mockResolvedValue(imgOut('atlas', 0.08));

    const g = createGeneration({ sessionId: sid(), origin: 'composer', kind: 'image', prompt: 'over', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    await runGeneration(g.id).catch(() => undefined);

    expect(atlasSpy).not.toHaveBeenCalled();
  });

  it.fails('mantiene lock de nodo durante la sustitución tras 402 para bloquear runNodes concurrente', async () => {
    setupStore({ autoSwitch: 'always' });
    vi.spyOn(ADAPTERS.atlas, 'balance').mockResolvedValue(10);
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockRejectedValue(new HttpError(402, 'Insufficient credits', {}));

    const sId = sid();
    const g = createGeneration({ sessionId: sId, origin: 'node', stepId: 'n1', kind: 'image', prompt: 'node', modelRef: NANO, settings: defSet, inputs: { refs: [] } });
    const graph = {
      nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Image', prompt: 'node', modelRef: NANO, settings: defSet, generationId: g.id, outputIndex: 0 } }],
      edges: [],
    } as unknown as Graph;
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sId]: { ...s.sessions[sId], graph } } }));

    let releaseSub!: () => void;
    let enteredSub!: () => void;
    const inSub = new Promise<void>((r) => { enteredSub = r; });
    let subCalls = 0;
    let lockedDuringSub = false;
    const atlasSpy = vi.spyOn(ADAPTERS.atlas, 'generate').mockImplementation(async () => {
      if (++subCalls === 1) {
        lockedDuringSub = lockedNodes(sId).has('n1');
        enteredSub();
        await new Promise<void>((r) => { releaseSub = r; });
      }
      return imgOut('atlas', 0.08);
    });

    const first = runGeneration(g.id);
    await inSub;
    const concurrent = runNodes(sId, ['n1']).catch((e: Error) => e);
    releaseSub();
    await first;
    const secondResult = await concurrent;

    expect(lockedDuringSub).toBe(true);
    expect(secondResult).toBeInstanceOf(Error);
    expect(atlasSpy).toHaveBeenCalledTimes(1);
  });
});

describe('6. onAgentCredit con presupuesto agotado (overLimit)', () => {
  const llm = (id: string, name: string, inputPrice: number, outputPrice: number) =>
    ({ id, name, tools: true, vision: true, inputPrice, outputPrice }) as never;

  it.fails('sustituto hasta 1,5x respeta overLimit antes de cambiar el modelo del agente', async () => {
    setupStore({ budgetOn: true, budgetUsd: 0.01, spentUsd: 0.02, autoSwitch: 'ask' });
    const st = useStore.getState();
    useStore.setState({
      catalog: {
        ...st.catalog,
        llm: {
          ...st.catalog.llm,
          nanogpt: [llm('m-a', 'Model A', 1, 1)],
          openrouter: [llm('m-b', 'Model B', 1.4, 1.4)],
        },
      },
    });
    vi.spyOn(ADAPTERS.openrouter, 'balance').mockResolvedValue(10);

    await onAgentCredit();
    const offer = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label.includes('Model B')));
    if (offer) offer.actions!.find((x) => x.label.includes('Model B'))!.run();

    expect(useStore.getState().settings.agent.provider).toBe('nanogpt');
    expect(useAlerts.getState().alerts.some((a) => /limit|budget/i.test(a.text))).toBe(true);
  });

  it.fails('modo always no auto-sustituye el agente cuando el presupuesto está agotado', async () => {
    setupStore({ budgetOn: true, budgetUsd: 0.01, spentUsd: 0.02, autoSwitch: 'always' });
    const st = useStore.getState();
    useStore.setState({
      catalog: {
        ...st.catalog,
        llm: {
          ...st.catalog.llm,
          nanogpt: [llm('m-a', 'Model A', 1, 1)],
          openrouter: [llm('m-a2', 'Model A', 1, 1)],
        },
      },
    });
    vi.spyOn(ADAPTERS.openrouter, 'balance').mockResolvedValue(10);

    const switched = await onAgentCredit();
    expect(switched).toBe(false);
    expect(useStore.getState().settings.agent.provider).toBe('nanogpt');
  });
});
