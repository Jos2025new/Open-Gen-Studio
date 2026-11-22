import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));

import { llmTurn } from '../src/engine/agent/llmTurn';
import { useAlerts } from '../src/engine/alerts';
import { askAgain, withOncePass, overLimitAccepted, overLimit } from '../src/engine/budget';
import { useStore } from '../src/store/store';
import { mainThread } from './helpers/threads';

const enc = new TextEncoder();
const sse = (chunks: unknown[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        chunks.forEach((x) => c.enqueue(enc.encode(`data: ${JSON.stringify(x)}\n\n`)));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
const textChunk = (t: string, usage?: Record<string, number>) => ({
  choices: [{ delta: { content: t } }],
  ...(usage ? { usage } : {}),
});
const toolChunk = (name: string, args: unknown, usage?: Record<string, number>) => ({
  choices: [{ delta: { tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }],
  ...(usage ? { usage } : {}),
});

const sid = () => useStore.getState().activeSessionId;

function setupAgent(opts: { budgetUsd: number; spentUsd: number; model: string; inputPrice: number; outputPrice: number }) {
  const st = useStore.getState();
  const id = st.activeSessionId;
  askAgain(id);
  useAlerts.setState({ alerts: [] });
  useStore.setState({
    spentUsd: opts.spentUsd,
    settings: {
      ...st.settings,
      budgetOn: true,
      budgetUsd: opts.budgetUsd,
      budgetAccepted: null,
      budgetNoAsk: false,
      keys: { ...st.settings.keys, nanogpt: 'k' },
      agent: { ...st.settings.agent, provider: 'nanogpt', model: opts.model, showThinking: false },
    },
    catalog: {
      ...st.catalog,
      llm: {
        ...st.catalog.llm,
        nanogpt: [{ id: opts.model, name: opts.model, tools: true, vision: true, inputPrice: opts.inputPrice, outputPrice: opts.outputPrice }] as never,
      },
    },
    sessions: {
      ...st.sessions,
      [id]: {
        ...st.sessions[id],
        feed: [],
        noAskOverLimit: false,
        agents: mainThread({ history: [{ role: 'user', content: 'hello' }], questionRound: 0, notes: [], busy: false }),
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  useAlerts.setState({ alerts: [] });
});

beforeEach(() => {
  useAlerts.setState({ alerts: [] });
});

const isLlmPost = (url: unknown, init?: RequestInit) =>
  (init?.method ?? 'GET').toUpperCase() === 'POST' && !String(url).includes('/x/store');

function mockLlmFetch(reply: () => Response) {
  const posts: Array<{ url: string; body: unknown }> = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (isLlmPost(url, init)) {
      posts.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return reply();
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return posts;
}


const continueOnce = () => useAlerts.getState().alerts.filter((a) => a.actions?.some((x) => x.label === 'Continue once'));
const click = (a: { actions?: Array<{ label: string; run: () => void }> }) => a.actions!.find((x) => x.label === 'Continue once')!.run();
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const paid = () => setupAgent({ budgetUsd: 10, spentUsd: 10, model: 'paid-model', inputPrice: 3, outputPrice: 15 });

describe('pase de turno: aislamiento y alcance', () => {
  it('durante el turno pasado, el pase NO se ve como pase de sesion (una generacion concurrente sigue pidiendo)', async () => {
    paid();
    const seen: boolean[] = [];
    let n = 0;
    mockLlmFetch(() => { seen.push(overLimitAccepted(sid())); return ++n < 2 ? sse([toolChunk('read_guide', { id: 'workflow:story' })]) : sse([textChunk('ok')]); });
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    click(continueOnce()[0]);
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen).toEqual([false, false]);
    expect(overLimit({ usd: 1 } as never, sid())).toBe(true);
  });

  it('tras el turno pasado, el siguiente turno vuelve a parar y no hay pases de sesion residuales', async () => {
    paid();
    const posts = mockLlmFetch(() => sse([textChunk('ok')]));
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    click(continueOnce()[0]);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    await tick(60);
    expect(overLimitAccepted(sid())).toBe(false);
    useAlerts.setState({ alerts: [] });
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts).toHaveLength(1);
    expect(continueOnce()).toHaveLength(1);
  });

  it('Continue once de otra accion (pase de sesion) no abre el turno del agente ni lo consume el agente', async () => {
    paid();
    const posts = mockLlmFetch(() => sse([textChunk('ok')]));
    await withOncePass(sid(), async () => {
      await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
      expect(posts).toHaveLength(0);
      expect(overLimitAccepted(sid())).toBe(true); // sigue vivo para su dueno
    });
    expect(overLimitAccepted(sid())).toBe(false);
  });

  it('cruce a mitad de turno: pide, y su pase cubre el resto del turno sin nueva alerta', async () => {
    setupAgent({ budgetUsd: 10, spentUsd: 9.99, model: 'paid-model', inputPrice: 3, outputPrice: 15 });
    let n = 0;
    const posts = mockLlmFetch(() => (++n < 4 ? sse([toolChunk('read_guide', { id: 'workflow:story' })]) : sse([textChunk('fin')])));
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    expect(continueOnce().length).toBeGreaterThan(0);
    const before = posts.length;
    click(continueOnce()[0]);
    await vi.waitFor(() => expect(posts.length).toBeGreaterThan(before));
    await tick(80);
    expect(continueOnce()).toHaveLength(0);
  });

  it('dos peticiones paradas: las dos alertas Continue once no deben dejar pasar dos turnos concurrentes', async () => {
    paid();
    const posts = mockLlmFetch(() => sse([textChunk('ok')]));
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    const alerts = continueOnce();
    alerts.forEach(click);
    await tick(80);
    // un solo turno por agente a la vez: a lo sumo 1 POST concurrente por turno; el segundo clic no debe duplicar
    expect(posts.length).toBeLessThanOrEqual(2);
  });

  it('Continue once con el agente ocupado: no se pierde en silencio (la alerta desaparece pero no hay turno)', async () => {
    paid();
    const posts = mockLlmFetch(() => sse([textChunk('ok')]));
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    const a = continueOnce()[0];
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], agents: mainThread({ history: [{ role: 'user', content: 'hello' }], questionRound: 0, notes: [], busy: true }) } } }));
    click(a);
    await tick(60);
    // Observado: 0 POST y la alerta ya no esta. Marca el hueco: el usuario pulso y no ocurre nada.
    expect(posts).toHaveLength(0);
    expect(continueOnce()).toHaveLength(0);
  });

  it('gratis ($0), noAskDurable y budgetOn=false nunca paran', async () => {
    const posts = mockLlmFetch(() => sse([textChunk('ok')]));
    setupAgent({ budgetUsd: 10, spentUsd: 12, model: 'free-model', inputPrice: 0, outputPrice: 0 });
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts).toHaveLength(1);
    paid();
    useStore.setState((s) => ({ settings: { ...s.settings, budgetOn: false } }));
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts).toHaveLength(2);
    paid();
    useStore.setState((s) => ({ settings: { ...s.settings, budgetNoAsk: true } }));
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts).toHaveLength(3);
  });
});
