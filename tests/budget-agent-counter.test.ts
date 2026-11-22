import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
import { askAgain } from '../src/engine/budget';
import { SessionBudget } from '../src/components/shell/SessionTools';
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

describe('1. llmTurn budget limit guard', () => {
  it('exhausted limit: 0 POSTs and warn alert; "Continue once" resumes once (1 POST); next turn stops again', async () => {
    setupAgent({ budgetUsd: 10, spentUsd: 10, model: 'paid-model', inputPrice: 3, outputPrice: 15 });
    const posts = mockLlmFetch(() => sse([textChunk('Approved reply.')]));

    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });

    expect(posts).toHaveLength(0);
    const alert = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label === 'Continue once'));
    expect(alert).toBeDefined();
    expect(alert?.level).toBe('warn');

    const go = alert!.actions!.find((x) => x.label === 'Continue once')!;
    go.run();
    go.run(); // double-click must not run two concurrent turns

    await vi.waitFor(() => {
      const feed = useStore.getState().sessions[sid()].feed;
      expect(feed.some((f) => f.type === 'assistant' && f.text === 'Approved reply.')).toBe(true);
    });
    expect(posts).toHaveLength(1);

    // Next turn asks again (once-pass was single-use)
    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts).toHaveLength(1);
    expect(useAlerts.getState().alerts.some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true);
  });

  it('crossing the limit mid-turn stops before the second paid POST and resumes on "Continue once"', async () => {
    // Remaining budget ($0.02) covers iteration 0's estimate ($0.0105), then iteration 0 spends $0.05 -> over limit.
    setupAgent({ budgetUsd: 10, spentUsd: 9.98, model: 'paid-model', inputPrice: 3, outputPrice: 15 });
    let n = 0;
    const posts = mockLlmFetch(() => {
      n++;
      if (n === 1) return sse([toolChunk('read_guide', { id: 'workflow:story' }, { prompt_tokens: 1000, completion_tokens: 500, cost: 0.05 })]);
      return sse([textChunk('Finished after guide.')]);
    });

    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });

    expect(posts).toHaveLength(1);
    const alert = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label === 'Continue once'));
    expect(alert).toBeDefined();

    alert!.actions!.find((x) => x.label === 'Continue once')!.run();
    await vi.waitFor(() => {
      const feed = useStore.getState().sessions[sid()].feed;
      expect(feed.some((f) => f.type === 'assistant' && f.text === 'Finished after guide.')).toBe(true);
    });
    expect(posts).toHaveLength(2);
  });

  it('a tool-using turn after "Continue once" completes 2 POSTs with one click, and the next turn stops again', async () => {
    setupAgent({ budgetUsd: 10, spentUsd: 10, model: 'paid-model', inputPrice: 3, outputPrice: 15 });
    let n = 0;
    const posts = mockLlmFetch(() => {
      n++;
      if (n === 1) return sse([toolChunk('read_guide', { id: 'workflow:story' })]);
      return sse([textChunk('Done after tool.')]);
    });

    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts).toHaveLength(0);
    const alert = useAlerts.getState().alerts.find((a) => a.actions?.some((x) => x.label === 'Continue once'));
    expect(alert?.text).toContain('\u201cContinue once\u201d lets only this run through; \u201cDon\u2019t ask again\u201d stops asking in this session. Nothing running is stopped.');
    expect(alert?.actions?.map((x) => x.label)).toEqual(['Continue once', 'Don\u2019t ask again', 'Cancel']);

    alert!.actions!.find((x) => x.label === 'Continue once')!.run();
    await vi.waitFor(() => {
      const feed = useStore.getState().sessions[sid()].feed;
      expect(feed.some((f) => f.type === 'assistant' && f.text === 'Done after tool.')).toBe(true);
    });
    expect(posts).toHaveLength(2);
    expect(useAlerts.getState().alerts).toHaveLength(0);

    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts).toHaveLength(2);
    expect(useAlerts.getState().alerts.some((a) => a.actions?.some((x) => x.label === 'Continue once'))).toBe(true);
  });

  it('free LLM model (0/0) never brakes even when budget is exhausted', async () => {
    setupAgent({ budgetUsd: 10, spentUsd: 12, model: 'free-model', inputPrice: 0, outputPrice: 0 });
    const posts = mockLlmFetch(() => sse([textChunk('Free reply.')]));

    await llmTurn(sid(), 'chat', { route: 'new', agentNodeId: 'main' });

    expect(posts).toHaveLength(1);
    expect(useAlerts.getState().alerts).toHaveLength(0);
    const feed = useStore.getState().sessions[sid()].feed;
    expect(feed.some((f) => f.type === 'assistant' && f.text === 'Free reply.')).toBe(true);
  });
});

describe('2. SessionBudget counter over limit', () => {
  it('shows "$12 of $10 · +$2 over" with full danger bar when spent > limit', () => {
    const html = renderToStaticMarkup(createElement(SessionBudget, { spent: 12, limit: 10 }));
    expect(html).toContain('$12 of $10 · +$2 over');
    expect(html).not.toContain('left');
    expect(html).toContain('si-budget is-over');
    expect(html).toContain('width:100%');
  });

  it('shows remaining amount without over class when within limit', () => {
    const html = renderToStaticMarkup(createElement(SessionBudget, { spent: 4, limit: 10 }));
    expect(html).toContain('$4 of $10 · $6 left');
    expect(html).not.toContain('over');
    expect(html).toContain('width:40%');
  });
});
