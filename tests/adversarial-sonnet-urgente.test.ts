import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob(['test'], { type: 'image/png' }), putAssetBlob: async () => undefined,
}));

import { useStore } from '../src/store/store';
import { beginOncePass, consumeOnce, overLimit, withOncePass } from '../src/engine/budget';
import { graphToSteps } from '../src/engine/flow/graph';
import { previewRun } from '../src/engine/flow/actions';
import { lockNodes } from '../src/engine/flow/locks';
import { useAlerts } from '../src/engine/alerts';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import type { Generation, Graph } from '../src/engine/types';

/* Ataque (Sonnet, 2026-11-22) a task/urgente-dinero: topes de un pase, precio desconocido, nodos con intento dudoso. */
const sid = () => useStore.getState().activeSessionId;
const price = (usd: number | null, lowerBound = false) => ({ usd, approximate: usd === null || lowerBound, ...(lowerBound ? { lowerBound } : {}) });

beforeEach(() => {
  const st = useStore.getState();
  useAlerts.setState({ alerts: [] });
  useStore.setState({ generations: {}, spentUsd: 1, spendLog: [],
    settings: { ...st.settings, budgetOn: true, budgetUsd: 1, budgetAccepted: null, budgetNoAsk: false } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('pases de un solo uso', () => {
  it('un pase de $0.10 conocido no cubre un precio con cota inferior', () => {
    withOncePass(sid(), (pass) => {
      expect(overLimit(price(0.05, true), sid(), pass)).toBe(true);
    }, 0.1);
  });
  it('un desconocido aprobado vale una vez en un pase de secuencia', () => {
    const { pass, end } = beginOncePass(sid(), null, 1);
    try {
      consumeOnce(pass, price(null));
      expect(overLimit(price(null), sid(), pass)).toBe(true);
      expect(overLimit(price(0.01), sid(), pass)).toBe(true);
    } finally { end(); }
  });
});

describe('nodo con intento dudoso', () => {
  const data = (title: string) => ({ kind: 'image' as const, title, prompt: 'p', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, outputIndex: 0 });
  const attempt = (over: Partial<Generation>): Generation => ({ id: 'g', sessionId: sid(), kind: 'image', status: 'done', assetIds: [], createdAt: 1, ...over } as unknown as Generation);
  const setup = (upstreamAttempt: Partial<Generation>) => {
    const graph: Graph = {
      nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { ...data('A'), generationId: 'g1' } },
        { id: 'b', position: { x: 300, y: 0 }, data: { ...data('B'), kind: 'video', modelRef: 'local::studio-video' } }],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'first' }],
    } as unknown as Graph;
    const generations = { g1: attempt({ id: 'g1', assetIds: ['asset-1'], createdAt: 1 }),
      g2: attempt({ id: 'g2', status: 'error', origin: 'node', stepId: 'a', createdAt: 2, ...upstreamAttempt }) };
    useStore.setState((s) => ({ generations, sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], graph } } }));
    return { graph, generations };
  };

  it('un intento dudoso aguas arriba no bloquea a un nodo que solo usa su ultimo resultado bueno', () => {
    const { graph, generations } = setup({ lostJob: true });
    const assets = { 'asset-1': { id: 'asset-1', kind: 'image' } as never };
    useStore.setState({ assets });
    const plan = graphToSteps(graph, ['b'], generations, { assets });
    expect(plan.errors).toEqual([]);
    expect(plan.runIds).toEqual(['b']);
    expect(plan.steps[0]).toMatchObject({ firstFrame: 'asset:asset-1' });
    const preview = previewRun(sid(), ['b']);
    expect(preview.errors).not.toContain('“A” is already running.');
    expect(preview.errors).toEqual([]);
    expect(preview.runIds).toEqual(['b']);
    expect(preview.steps).toEqual(plan.steps);

    const uncertain = 'The previous attempt for “A” may have been submitted. Check its status before running again.';
    expect(graphToSteps(graph, ['a'], generations, { assets }).errors).toEqual([uncertain]);
    expect(previewRun(sid(), ['a']).errors).toEqual([uncertain]);
    expect(previewRun(sid(), ['a'], false).errors).toEqual([]);

    const release = lockNodes(sid(), ['a']);
    try {
      expect(previewRun(sid(), ['b']).errors).toEqual(['“A” is already running.']);
    } finally {
      release();
    }
    setup({ status: 'running' });
    expect(previewRun(sid(), ['a']).errors).toEqual(['“A” is already running.']);
  });
});

describe('modelo LLM aun sin catalogo cargado', () => {
  it('el primer turno tras abrir la app no pregunta por un modelo que el catalogo prueba gratuito', async () => {
    const st = useStore.getState();
    const chat = vi.fn();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).includes('/models')) return new Response(JSON.stringify({ data: [{ id: 'm', pricing: { prompt: '0', completion: '0' }, capabilities: { tool_calling: true } }] }));
      chat(init);
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    useStore.setState({ catalog: { ...st.catalog, llm: {}, llmStatus: {} } as never,
      ui: { ...st.ui, workspace: 'chat' },
      settings: { ...st.settings, budgetOn: true, budgetUsd: 100, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } } });
    await sendAgentMessage('hola');
    expect(useAlerts.getState().alerts).toEqual([]);
    expect(chat.mock.calls.filter(([init]) => init?.method === 'POST' && String(init.body).includes('"model":"m"'))).toHaveLength(1);
  });
});

describe('Retry de un nodo con resultado bueno previo', () => {
  const REF = 'nanogpt::test-image';
  it('mantiene el resultado bueno mientras reintenta y enlaza el nuevo al terminar', async () => {
    const { createGeneration, retryGeneration } = await import('../src/engine/jobs');
    const { ADAPTERS } = await import('../src/engine/providers/registry');
    const st = useStore.getState();
    const settings = { count: 1, resolution: 'new', advanced: {} };
    useStore.setState({
      settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, budgetOn: false },
      catalog: { ...st.catalog, models: { [REF]: { ref: REF, provider: 'nanogpt', id: 'test-image', name: 'Test', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] } } as never },
        schemas: { [REF]: { ref: REF, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' } } as never },
    });
    const spec = { sessionId: sid(), origin: 'node' as const, stepId: 'n1', kind: 'image' as const, prompt: 'a', modelRef: REF, settings, inputs: { refs: [] } };
    const good = createGeneration(spec);
    const bad = createGeneration(spec);
    const node = { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Image', prompt: 'a', modelRef: REF, settings, outputIndex: 0, generationId: good.id } };
    useStore.setState((s) => ({ generations: { ...s.generations, [good.id]: { ...good, status: 'done', assetIds: ['keep'] }, [bad.id]: { ...bad, status: 'error', createdAt: good.createdAt + 1 } },
      sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], graph: { nodes: [node], edges: [] } as unknown as Graph } } }));
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async () => { await gate; return { outputs: [{ blob: new Blob(['i'], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.1 }; });
    const retry = retryGeneration(bad.id);
    const linked = () => (useStore.getState().sessions[sid()].graph.nodes[0].data as { generationId?: string }).generationId;
    expect(linked()).toBe(good.id);
    open();
    await retry;
    const fresh = Object.keys(useStore.getState().generations).find((id) => ![good.id, bad.id].includes(id))!;
    expect(linked()).toBe(fresh);
  });
});
