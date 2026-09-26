import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { approvePlan, cancelPlan, sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { AgentStyle, PlanFeedItem } from '../src/engine/types';

type Reply = { plan?: { texts: string[]; revision?: boolean }; questions?: boolean; text?: string };

const sse = (r: Reply) => {
  const chunks: unknown[] = [];
  if (r.text) chunks.push({ choices: [{ delta: { content: r.text } }] });
  const call = (name: string, args: unknown) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
  if (r.plan) chunks.push(call('propose_plan', { title: 'P', revision: r.plan.revision, steps: r.plan.texts.map((t, i) => ({ id: `s${i + 1}`, kind: 'text', text: t })) }));
  if (r.questions) chunks.push(call('ask_questions', { questions: [{ id: 'q1', question: 'Style?', options: ['A', 'B'] }] }));
  chunks.push({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50, cost: 0.001 } });
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
};

let replies: Reply[] = [];

function setup(style: AgentStyle) {
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    return sse(replies.shift() ?? { text: 'ok' });
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: style, attachments: [] },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agentMetrics: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
}
afterEach(() => vi.unstubAllGlobals());

const sid = () => useStore.getState().activeSessionId;
const metrics = () => useStore.getState().sessions[sid()].agentMetrics ?? [];
const plans = () => useStore.getState().sessions[sid()].feed.filter((f): f is PlanFeedItem => f.type === 'plan');

describe('agent metrics per request (R0)', () => {
  beforeEach(() => setup('guided'));

  it('counts calls, tokens, the plan, a revision and the approval of one request', async () => {
    replies = [{ plan: { texts: ['a', 'b'] } }];
    await sendAgentMessage('two clips');
    expect(metrics()).toHaveLength(1);
    expect(metrics()[0]).toMatchObject({ request: 'two clips', llmCalls: 1, inputTokens: 1000, outputTokens: 50, plans: 1, revisions: 0, questionRounds: 0 });
    expect(metrics()[0].msToPlan).toBeGreaterThanOrEqual(0);
    expect(metrics()[0].msToFirstOutput).toBeGreaterThanOrEqual(0);
    expect(metrics()[0].outcome).toBeUndefined();

    replies = [{ plan: { texts: ['a', 'B'], revision: true } }];
    await sendAgentMessage('change the second');
    expect(metrics()).toHaveLength(1);
    expect(metrics()[0]).toMatchObject({ llmCalls: 2, inputTokens: 2000, plans: 2, revisions: 1 });
    expect(metrics()[0].llmUsd).toBeCloseTo(0.002);

    await approvePlan(sid(), plans()[0].id);
    expect(metrics()[0].outcome).toBe('approved');
  });

  it('answering questions stays in the same request and counts the round', async () => {
    replies = [{ questions: true }];
    await sendAgentMessage('animate this');
    expect(metrics()[0]).toMatchObject({ questionRounds: 1, llmCalls: 1, plans: 0 });
    replies = [{ plan: { texts: ['x'] } }];
    await sendAgentMessage('style A');
    expect(metrics()).toHaveLength(1);
    expect(metrics()[0]).toMatchObject({ questionRounds: 1, llmCalls: 2, plans: 1 });
  });

  it('a new request closes the open one as superseded', async () => {
    replies = [{ text: 'Which one?' }];
    await sendAgentMessage('animate');
    replies = [{ plan: { texts: ['x'] } }];
    await sendAgentMessage('something else');
    expect(metrics().map((m) => m.outcome)).toEqual(['superseded', undefined]);
  });

  it('records a canceled plan', async () => {
    replies = [{ plan: { texts: ['a'] } }];
    await sendAgentMessage('a');
    cancelPlan(sid(), plans()[0].id);
    expect(metrics()[0].outcome).toBe('canceled');
  });

  it('never sends the metrics to the model', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return sse({ plan: { texts: ['a'] } });
    });
    await sendAgentMessage('a');
    await sendAgentMessage('b');
    expect(bodies.some((b) => /msToPlan|llmCalls|agentMetrics/.test(b))).toBe(false);
  });
});

describe('auto mode', () => {
  beforeEach(() => setup('auto'));

  it('records the plan before the auto-approval closes the request', async () => {
    replies = [{ plan: { texts: ['a'] } }];
    await sendAgentMessage('a');
    await vi.waitFor(() => expect(metrics()[0].outcome).toBe('approved'));
    expect(metrics()[0]).toMatchObject({ plans: 1, llmCalls: 1 });
    await vi.waitFor(() => expect(useStore.getState().sessions[sid()].agent.busy).toBe(false));
    expect(metrics()[0].agentMs).toBeGreaterThanOrEqual(metrics()[0].msToPlan!);
    expect(metrics()[0].msToPlan).toBeGreaterThanOrEqual(0);
  });
});
