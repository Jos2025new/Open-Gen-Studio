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

import { createSession, setSettings, useStore } from '../src/store/store';
import { askAgain, budgetVerdict, dontAskAgain, llmCallEstimate, overLimitText, withOncePass } from '../src/engine/budget';
import { approvePlan } from '../src/engine/agent/planRun';
import { llmTurn } from '../src/engine/agent/llmTurn';
import { useAlerts } from '../src/engine/alerts';
import { ADAPTERS } from '../src/engine/providers/registry';
import type { ModelSummary, PlanFeedItem } from '../src/engine/types';
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

const NANO_IMG = 'nanogpt::seed';
const imgModel: ModelSummary = {
  ref: NANO_IMG,
  provider: 'nanogpt',
  id: 'seed',
  name: 'seed',
  kind: 'image',
  acceptsText: true,
  acceptsImage: false,
  tags: [],
  price: { skus: [{ unit: 'output', usd: 0.1 }] },
} as unknown as ModelSummary;

const isLlmPost = (url: unknown, init?: RequestInit) =>
  (init?.method ?? 'GET').toUpperCase() === 'POST' && !String(url).includes('/x/store');

function mockLlmFetch(reply: () => Response) {
  let posts = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    if (isLlmPost(url, init)) {
      posts++;
      return reply();
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return () => posts;
}

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
  const schema = { params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' };
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
      models: { ...st.catalog.models, [NANO_IMG]: imgModel },
      schemas: { ...st.catalog.schemas, [NANO_IMG]: { ref: NANO_IMG, ...schema } } as never,
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

function attachPlan(sessionId: string, itemId = 'plan-card-1'): PlanFeedItem {
  const settings = { count: 1, advanced: {} };
  const item: PlanFeedItem = {
    id: itemId,
    workspace: 'chat',
    createdAt: Date.now(),
    type: 'plan',
    style: 'direct',
    status: 'awaiting',
    plan: {
      id: `pln-${itemId}`,
      title: 'Paid Image Plan',
      summary: 'One paid image',
      workspace: 'chat',
      steps: [{ id: 's1', title: 'Shot 1', kind: 'image', prompt: 'sunset', modelRef: NANO_IMG, settings, refs: [] }],
      adjustments: [],
    },
    estimate: { usd: 0.1, approximate: false },
    stepStates: {},
    stepGenerations: {},
  };
  useStore.setState((s) => ({
    sessions: {
      ...s.sessions,
      [sessionId]: { ...s.sessions[sessionId], feed: [...s.sessions[sessionId].feed, item] },
    },
  }));
  return item;
}

beforeEach(() => {
  vi.spyOn(ADAPTERS.nanogpt, 'generate').mockResolvedValue({
    outputs: [{ blob: new Blob(['img'], { type: 'image/png' }), mime: 'image/png' }],
    costUsd: 0.1,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAlerts.setState({ alerts: [] });
});

describe('Part 3b: agent turn over-limit choices and plan wrap-up budget guard', () => {
  it('guardLlmBudget uses the same overLimitText copy and Continue once / Don’t ask again / Cancel buttons as other dialogs', async () => {
    setup({ budgetUsd: 0.05, spentUsd: 0.05 });
    const posts = mockLlmFetch(() => sse('Agent reply.'));

    await llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });

    expect(posts()).toBe(0);
    expect(alerts()).toHaveLength(1);
    const alert = alerts()[0];
    expect(alert.level).toBe('warn');
    const expectedCopy = overLimitText(llmCallEstimate('nanogpt', 'paid-model'));
    expect(alert.text).toContain(expectedCopy);
    expect(alert.text).toMatch(/Continue once/);
    expect(alert.text).toMatch(/Don\u2019t ask again/);
    expect(alert.text).toMatch(/Nothing running is stopped/);
    expect(alert.actions?.map((a) => a.label)).toEqual(['Continue once', 'Don\u2019t ask again', 'Cancel']);

    // Clicking "Don’t ask again" silences this session only and resumes the turn once.
    const dontAsk = actionOf('Don\u2019t ask again')!;
    dontAsk.run();
    dontAsk.run(); // double-click guard

    await vi.waitFor(() => {
      expect(useStore.getState().sessions[sidA].feed.some((f) => f.type === 'assistant' && f.text === 'Agent reply.')).toBe(true);
    });
    expect(posts()).toBe(1);
    expect(useStore.getState().sessions[sidA].noAskOverLimit).toBe(true);
    expect(useStore.getState().sessions[sidB].noAskOverLimit).toBe(false);

    // Next turn in session A runs without asking; session B still asks.
    await llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts()).toBe(2);
    expect(alerts()).toHaveLength(0);

    await llmTurn(sidB, 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts()).toBe(2);
    expect(actionOf('Continue once')).toBeDefined();
    expect(actionOf('Don\u2019t ask again')).toBeDefined();
  });

  it('plan passing the limit with "Continue once": wrap-up asks again, and "Continue once" runs only the wrap-up', async () => {
    setup({ budgetUsd: 0.05, spentUsd: 0 });
    const posts = mockLlmFetch(() => sse('Wrap-up done.'));
    const card = attachPlan(sidA);

    expect(budgetVerdict(card.estimate, { sessionId: sidA }).over).toBe(true);
    await withOncePass(sidA, (pass) => approvePlan(sidA, card.id, pass), card.estimate.usd, card.estimate.lowerBound);

    // Plan executed and passed the limit, so wrap-up llmTurn MUST ask again (0 LLM POSTs so far).
    expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(1);
    expect(useStore.getState().spentUsd).toBeGreaterThan(0.05);
    expect(posts()).toBe(0);
    const wrapAlert = alerts().find((a) => a.actions?.some((x) => x.label === 'Continue once'));
    expect(wrapAlert).toBeDefined();
    expect(wrapAlert?.actions?.map((a) => a.label)).toEqual(['Continue once', 'Don\u2019t ask again', 'Cancel']);

    // Approving wrap-up with "Continue once" runs the closing message; a subsequent turn asks again.
    actionOf('Continue once')!.run();
    await vi.waitFor(() => {
      expect(useStore.getState().sessions[sidA].feed.some((f) => f.type === 'assistant' && f.text === 'Wrap-up done.')).toBe(true);
    });
    expect(posts()).toBe(1);

    await llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts()).toBe(1);
    expect(actionOf('Continue once')).toBeDefined();
  });

  it('plan passing the limit with "Don’t ask again": wrap-up runs without asking again', async () => {
    setup({ budgetUsd: 0.05, spentUsd: 0 });
    const posts = mockLlmFetch(() => sse('Wrap-up automatic.'));
    const card = attachPlan(sidA);

    dontAskAgain(sidA);
    await approvePlan(sidA, card.id);

    expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(1);
    expect(posts()).toBe(1);
    expect(alerts()).toHaveLength(0);
    expect(useStore.getState().sessions[sidA].feed.some((f) => f.type === 'assistant' && f.text === 'Wrap-up automatic.')).toBe(true);
  });

  it('agent turn "Don’t ask again" also covers the closing wrap-up of a subsequent plan in the same session', async () => {
    setup({ budgetUsd: 0.05, spentUsd: 0.05 });
    const posts = mockLlmFetch(() => sse('Closed cleanly.'));

    // First agent turn hits the limit -> user picks "Don’t ask again".
    await llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts()).toBe(0);
    actionOf('Don\u2019t ask again')!.run();
    await vi.waitFor(() => expect(posts()).toBe(1));

    // Plan in the same session runs and its wrap-up does NOT ask again.
    const card = attachPlan(sidA);
    await approvePlan(sidA, card.id);
    expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(1);
    expect(posts()).toBe(2);
    expect(alerts()).toHaveLength(0);
  });

  it('with Settings "Don’t ask in any session" (budgetNoAsk), over-limit runs and wrap-up never ask again in any session', async () => {
    setup({ budgetUsd: 0.05, spentUsd: 0.05, budgetNoAsk: false });
    const posts = mockLlmFetch(() => sse('No more prompts.'));

    // Over limit before turning the setting on -> asks once.
    await llmTurn(sidA, 'chat', { route: 'new', agentNodeId: 'main' });
    expect(alerts()).toHaveLength(1);
    actionOf('Cancel')!.run();
    expect(posts()).toBe(0);

    // User enables the existing Settings -> Budget "Don't ask in any session" switch (budgetNoAsk).
    setSettings({ budgetNoAsk: true, budgetAccepted: null });
    const card = attachPlan(sidA);
    expect(budgetVerdict(card.estimate, { sessionId: sidA }).over).toBe(false);

    // Plan runs + wrap-up runs + another session runs: zero additional limit alerts.
    await approvePlan(sidA, card.id);
    expect(ADAPTERS.nanogpt.generate).toHaveBeenCalledTimes(1);
    expect(posts()).toBe(1);
    expect(alerts()).toHaveLength(0);

    await llmTurn(sidB, 'chat', { route: 'new', agentNodeId: 'main' });
    expect(posts()).toBe(2);
    expect(alerts()).toHaveLength(0);
  });
});
