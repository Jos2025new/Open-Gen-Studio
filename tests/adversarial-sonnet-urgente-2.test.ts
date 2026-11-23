import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  probeMedia: async () => ({ width: 64, height: 64, size: 1 }),
  jpegThumbnail: async () => undefined,
}));

import { createSession, useStore } from '../src/store/store';
import { askAgain } from '../src/engine/budget';
import { stopAgent } from '../src/engine/agent/runtimeShared';
import { sendAgentMessage } from '../src/engine/agent/conversation';
import { llmTurn } from '../src/engine/agent/llmTurn';
import { useAlerts } from '../src/engine/alerts';
import { ADAPTERS } from '../src/engine/providers/registry';
import { mainThread } from './helpers/threads';

const enc = new TextEncoder();
const sse = (text: string) =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );

const isLlmPost = (url: unknown, init?: RequestInit) =>
  (init?.method ?? 'GET').toUpperCase() === 'POST' && !String(url).includes('/x/store');

const alerts = () => useAlerts.getState().alerts;
const actionOf = (label: string) => alerts().flatMap((a) => a.actions ?? []).find((x) => x.label === label);

let sidA: string;
let sidB: string;

function setup(opts: { budgetUsd?: number; spentUsd?: number; budgetNoAsk?: boolean } = {}) {
  const st = useStore.getState();
  const a = { ...createSession('Session A'), id: 'sess-a' };
  const b = { ...createSession('Session B'), id: 'sess-b' };
  sidA = a.id;
  sidB = b.id;
  askAgain(sidA);
  askAgain(sidB);
  useAlerts.setState({ alerts: [] });
  const agent = mainThread({ history: [{ role: 'user', content: 'hello' }], questionRound: 0, notes: [], busy: false });
  useStore.setState({
    generations: {},
    quotes: {},
    assets: {},
    spendLog: [],
    spentUsd: opts.spentUsd ?? 0,
    activeSessionId: sidA,
    settings: {
      ...st.settings,
      budgetOn: true,
      budgetUsd: opts.budgetUsd ?? 0.05,
      budgetAccepted: null,
      budgetNoAsk: opts.budgetNoAsk ?? false,
      keys: { ...st.settings.keys, nanogpt: 'k' },
      agent: { ...st.settings.agent, provider: 'nanogpt', model: 'paid-model', showThinking: false },
    },
    catalog: {
      ...st.catalog,
      llm: {
        ...st.catalog.llm,
        nanogpt: [{ id: 'paid-model', name: 'Paid LLM', tools: true, vision: true, inputPrice: 3, outputPrice: 15 }] as never,
      },
    },
    sessions: {
      [sidA]: { ...a, feed: [], noAskOverLimit: false, agents: agent },
      [sidB]: { ...b, feed: [], noAskOverLimit: false, agents: mainThread({ history: [{ role: 'user', content: 'hi' }], questionRound: 0, notes: [], busy: false }) },
    },
  });
}


const unpriced = () => useStore.setState((s) => ({ catalog: { ...s.catalog, llm: {}, llmStatus: {} } }));
const body = (m: { id: string; p: string }) => ({ data: [{ id: m.id, pricing: { prompt: m.p, completion: m.p }, capabilities: { tool_calling: true } }] });
function net(models: () => Promise<Response>) {
  const send = vi.fn(() => sse('Agent reply.'));
  const fetchModels = vi.fn(models);
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    if (String(url).includes('/models')) return fetchModels();
    if (isLlmPost(url, init)) return send();
    return new Response('{}');
  });
  return { send, fetchModels };
}
const busy = () => useStore.getState().sessions[sidA].agents.main?.busy ?? (Object.values(useStore.getState().sessions[sidA].agents as never as Record<string, { busy?: boolean }>).some((a) => a?.busy));

describe('espera de 3 s del catalogo LLM', () => {
  beforeEach(() => { setup({ budgetUsd: 1 }); unpriced(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('Stop durante la espera: no envia, no pregunta y libera al agente', async () => {
    let finish!: (r: Response) => void;
    const { send } = net(() => new Promise<Response>((r) => { finish = r; }));
    const turn = llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(busy()).toBe(true);
    stopAgent(sidA, 'main');
    await turn;
    finish(Response.json(body({ id: 'paid-model', p: '0.00001' })));
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();
    expect(alerts().filter((a) => a.actions?.length)).toEqual([]);
    expect(busy()).toBe(false);
  });

  it('catalogo que falla (HTTP 500): pregunta sin enviar y el agente queda libre', async () => {
    const { send } = net(async () => new Response('boom', { status: 500 }));
    const turn = llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });
    await vi.advanceTimersByTimeAsync(100);
    await turn;
    expect(send).not.toHaveBeenCalled();
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].text).toContain('The price of this run is unknown');
    expect(busy()).toBe(false);
  });

  it('catalogo que rechaza la peticion (red caida): pregunta sin enviar', async () => {
    const { send } = net(async () => { throw new TypeError('network'); });
    const turn = llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });
    await vi.advanceTimersByTimeAsync(100);
    await turn;
    expect(send).not.toHaveBeenCalled();
    expect(alerts()).toHaveLength(1);
  });

  it('modelo gratis 0/0 en el catalogo: envia sin preguntar', async () => {
    const { send } = net(async () => Response.json(body({ id: 'paid-model', p: '0' })));
    const turn = llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });
    await vi.advanceTimersByTimeAsync(100);
    await turn;
    expect(alerts()).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('catalogo listo pero sin el modelo: pregunta de inmediato, sin esperar 3 s', async () => {
    const { send } = net(async () => Response.json(body({ id: 'otro', p: '0.001' })));
    const turn = llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });
    await vi.advanceTimersByTimeAsync(100);
    await turn;
    expect(send).not.toHaveBeenCalled();
    expect(alerts()).toHaveLength(1);
  });

  it('un segundo mensaje mientras el primero espera no envia dos veces', async () => {
    let finish!: (r: Response) => void;
    const { send } = net(() => new Promise<Response>((r) => { finish = r; }));
    const a = sendAgentMessage('uno');
    await vi.advanceTimersByTimeAsync(500);
    const b = sendAgentMessage('dos');
    await vi.advanceTimersByTimeAsync(500);
    finish(Response.json(body({ id: 'paid-model', p: '0' })));
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([a, b]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('precio desconocido tras la espera y «Continue once»: envia exactamente una vez', async () => {
    const { send } = net(() => new Promise<Response>(() => undefined));
    const turn = llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });
    await vi.advanceTimersByTimeAsync(3000);
    await turn;
    expect(send).not.toHaveBeenCalled();
    actionOf('Continue once')!.run();
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(1);
    expect(busy()).toBe(false);
  });

  it('sin limite activo no espera al catalogo', async () => {
    useStore.setState((s) => ({ settings: { ...s.settings, budgetOn: false } }));
    const { send } = net(() => new Promise<Response>(() => undefined));
    const turn = llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    await turn;
  });
});

// ---- (b) bloqueo de nodos con intento dudoso ----
import { graphToSteps } from '../src/engine/flow/graph';
import { previewRun, runNodes } from '../src/engine/flow/actions';
import { regenerate } from '../src/engine/actions';
import type { Generation, Graph } from '../src/engine/types';

describe('intento dudoso aguas arriba: ningun camino lo reenvia', () => {
  const MAY = 'The previous attempt for “A” may have been submitted. Check its status before running again.';
  const data = (title: string) => ({ kind: 'image' as const, title, prompt: 'p', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, outputIndex: 0 });
  const gen = (over: Partial<Generation>): Generation => ({ id: 'g', sessionId: sidA, kind: 'image', status: 'done', assetIds: [], createdAt: 1, prompt: 'p', modelRef: 'local::studio-image', settings: { count: 1, advanced: {}, extras: {} }, inputs: { refs: [] }, estimate: { usd: 0.01, approximate: false }, ...over } as unknown as Generation);
  const assets = { 'asset-1': { id: 'asset-1', kind: 'image' } as never };
  /** good = A tiene un resultado bueno anterior; pin = cable fijado a ese resultado; stale = A editado tras el bueno */
  function build(o: { good?: boolean; pin?: boolean; stale?: boolean; extra?: Partial<Generation> } = {}) {
    setup({ budgetUsd: 1 });
    const graph = {
      nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { ...data('A'), generationId: o.good ? 'g1' : undefined, } },
        { id: 'b', position: { x: 300, y: 0 }, data: { ...data('B'), kind: 'video', modelRef: 'local::studio-video' } }],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'first', ...(o.pin ? { pin: 'asset-1' } : {}) }],
    } as unknown as Graph;
    const generations: Record<string, Generation> = {
      ...(o.good ? { g1: gen({ id: 'g1', assetIds: ['asset-1'], createdAt: 1, ...(o.stale ? { nodeRequest: 'stale-request' } : {}) }) } : {}),
      g2: gen({ id: 'g2', status: 'error', origin: 'node', stepId: 'a', createdAt: 2, lostJob: true, ...o.extra }),
    };
    useStore.setState((s) => ({ assets, generations, sessions: { ...s.sessions, [sidA]: { ...s.sessions[sidA], graph } } }));
    return { graph, generations };
  }
  const noResend = async (targets: string[], force = true) => {
    const generate = vi.spyOn(ADAPTERS.nanogpt, 'generate');
    const ex = await runNodes(sidA, targets, undefined, force);
    expect(ex?.outputs?.size ?? 0).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  };

  it('B forzado, A dudoso y vigente con resultado bueno: A no se toca', () => {
    const { graph, generations } = build({ good: true });
    const plan = graphToSteps(graph, ['b'], generations, { assets });
    expect(plan.runIds).toEqual(['b']);
    expect(plan.errors).toEqual([]);
  });

  it('A dudoso sin resultado bueno anterior: B no corre y A no se reenvia', async () => {
    const { graph, generations } = build({ good: false });
    const plan = graphToSteps(graph, ['b'], generations, { assets });
    expect(plan.runIds).not.toContain('a');
    expect(plan.errors).toContain(MAY);
    expect(previewRun(sidA, ['b']).errors).toContain(MAY);
    await noResend(['b']);
    await noResend(['b'], false);
  });

  it('A dudoso y desactualizado: forzar B ni ejecutar todo reenvia A', async () => {
    const { graph, generations } = build({ good: true, stale: true });
    const plan = graphToSteps(graph, ['b'], generations, { assets });
    expect(plan.runIds).not.toContain('a');
    expect(plan.errors).toEqual([MAY]);
    await noResend(['b']);
    await noResend(['a', 'b']);
  });

  it('cable fijado (pin) a A dudoso: B corre con el pin y A no se reenvia', async () => {
    const { graph, generations } = build({ good: false, pin: true });
    const plan = graphToSteps(graph, ['b'], generations, { assets });
    expect(plan.runIds).not.toContain('a');
    expect(plan.errors.filter((e) => e.includes('“A”'))).toEqual([]);
  });

  it.each(['g1', 'g2'])('regenerate de %s sobre A dudoso no envia nada', async (id) => {
    build({ good: true });
    const generate = vi.spyOn(ADAPTERS.nanogpt, 'generate');
    const before = Object.keys(useStore.getState().generations);
    await regenerate(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(Object.keys(useStore.getState().generations)).toEqual(before);
    expect(generate).not.toHaveBeenCalled();
  });

  it('control: sin dudoso, regenerate de g2 si crea un intento (los tests anteriores no son vacuos)', async () => {
    build({ good: true, extra: { lostJob: undefined } });
    const before = Object.keys(useStore.getState().generations).length;
    await regenerate('g2');
    await new Promise((r) => setTimeout(r, 50));
    expect(Object.keys(useStore.getState().generations).length).toBeGreaterThan(before);
  });

  it('remoteJob / sending / sends uncertain tambien bloquean y no se reenvian', async () => {
    for (const extra of [{ lostJob: undefined, remoteJob: { id: 'r' } }, { lostJob: undefined, sending: 1 }, { lostJob: undefined, sends: [{ status: 'uncertain' }] }] as Partial<Generation>[]) {
      const { graph, generations } = build({ good: false, extra });
      const plan = graphToSteps(graph, ['b'], generations, { assets });
      expect(plan.errors).toContain(MAY);
      await noResend(['b']);
    }
  });
});
