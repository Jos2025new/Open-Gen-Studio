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
import { askAgain, withOncePass, overLimitAccepted } from '../src/engine/budget';
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
const history = () => useStore.getState().sessions[sid()].agents.main.history as Array<{ role: string; content?: unknown }>;
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('verificacion 2: guardLlmBudget / llmTurn', () => {
  it('Continue once on a tool-using turn lets exactly ONE call through (3 iterations: 1 POST, then a new alert); history keeps one user message', async () => {
    setupAgent({ budgetUsd: 10, spentUsd: 10, model: 'paid-model', inputPrice: 3, outputPrice: 15 });
    let n = 0;
    const posts = mockLlmFetch(() => (++n < 3 ? sse([toolChunk('read_guide', { id: 'workflow:story' })]) : sse([textChunk('done')])));
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts).toHaveLength(0);
    click(continueOnce()[0]);
    await vi.waitFor(() => expect(useAlerts.getState().alerts.length).toBeGreaterThan(0));
    await tick();
    expect(posts).toHaveLength(1);
    expect(continueOnce()).toHaveLength(1); // stopped mid-turn: asks again
    const h = history();
    expect(h.filter((m) => m.role === 'user' && m.content === 'hello')).toHaveLength(1);
    expect(h[h.length - 1].role).toBe('tool'); // consistent: assistant tool_calls answered
    // second click resumes: another single call, still one user message
    click(continueOnce()[0]);
    await tick(60);
    expect(posts).toHaveLength(2);
    expect(history().filter((m) => m.role === 'user' && m.content === 'hello')).toHaveLength(1);
  });

  it('free model with exhausted limit: multi-iteration turn never brakes', async () => {
    setupAgent({ budgetUsd: 10, spentUsd: 99, model: 'free-model', inputPrice: 0, outputPrice: 0 });
    let n = 0;
    const posts = mockLlmFetch(() => (++n < 3 ? sse([toolChunk('read_guide', { id: 'workflow:story' })]) : sse([textChunk('done')])));
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts).toHaveLength(3);
    expect(continueOnce()).toHaveLength(0);
  });

  it('repeated blocked turns leave one alert; its single click runs one call', async () => {
    setupAgent({ budgetUsd: 10, spentUsd: 10, model: 'paid-model', inputPrice: 3, outputPrice: 15 });
    const posts = mockLlmFetch(() => sse([textChunk('ok')]));
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    const alerts = continueOnce();
    expect(alerts).toHaveLength(1); // pushAlert dedupes identical text: no stale twin
    click(alerts[0]);
    await tick(60);
    expect(posts).toHaveLength(1);
  });

  // BUG confirmado: guardLlmBudget ve el pase de la generacion como suyo, hace la llamada de pago y lo consume.
  it.fails('a Continue once pass opened for another action (a generation) is not stolen by an agent turn that starts meanwhile', async () => {
    setupAgent({ budgetUsd: 10, spentUsd: 10, model: 'paid-model', inputPrice: 3, outputPrice: 15 });
    const posts = mockLlmFetch(() => sse([textChunk('ok')]));
    const id = sid();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let acceptedAfter = true;
    const gen = withOncePass(id, async () => { await gate; acceptedAfter = overLimitAccepted(id); });
    await llmTurn(id, 'chat', { route: 'new', agentNodeId: 'main' });
    release();
    await gen;
    expect(posts).toHaveLength(0); // the agent's paid call needed its own approval
    expect(acceptedAfter).toBe(true); // and the generation's pass survived
  });
});
