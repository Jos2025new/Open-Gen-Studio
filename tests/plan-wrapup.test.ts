import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { approvePlan, sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { PlanFeedItem } from '../src/engine/types';

type Reply = { plan?: { title: string; revision?: boolean; texts: string[] }; text?: string };
const bodies: Array<{ messages: Array<{ role: string; content: unknown }>; tools?: unknown[] }> = [];

const sse = (r: Reply) => {
  const chunks: unknown[] = [];
  if (r.text) chunks.push({ choices: [{ delta: { content: r.text } }] });
  if (r.plan) {
    const args = JSON.stringify({ title: r.plan.title, revision: r.plan.revision, steps: r.plan.texts.map((t, i) => ({ id: `s${i + 1}`, kind: 'text', text: t })) });
    chunks.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: 'propose_plan', arguments: args } }] }, finish_reason: 'tool_calls' }] });
  }
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
};

let replies: Reply[] = [];
let chatCalls = 0;

beforeEach(() => {
  chatCalls = 0;
  bodies.length = 0;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    chatCalls++;
    bodies.push(body);
    return sse(replies.shift() ?? { text: 'ok' });
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'guided', attachments: [] },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

const plans = () => Object.values(useStore.getState().sessions[useStore.getState().activeSessionId].feed).filter((f): f is PlanFeedItem => f.type === 'plan');

const feed = () => useStore.getState().sessions[useStore.getState().activeSessionId].feed;

describe('brief wrap-up after a plan runs (S4)', () => {
  it('one text-only call with the app message and the MUST rule; its text appears in the chat', async () => {
    replies = [{ plan: { title: 'Two', texts: ['a', 'b'] } }, { text: 'Ready. Want a vertical cut, or leave it here?' }];
    await sendAgentMessage('two');
    await approvePlan(useStore.getState().activeSessionId, plans()[0].id);
    expect(chatCalls).toBe(2);
    const last = String(bodies[1].messages.at(-1)!.content);
    expect(last).toMatch(/^\[app\] Plan "Two" finished \(done\): s1 done; s2 done/);
    expect(last).toMatch(/MUST reply in at most 2 short sentences/);
    expect(feed().some((f) => f.type === 'assistant' && f.text === 'Ready. Want a vertical cut, or leave it here?')).toBe(true);
    expect(useStore.getState().sessions[useStore.getState().activeSessionId].agent.busy).toBe(false);
  });

  it('a tool call in the wrap-up is ignored: no new plan card, no second call', async () => {
    replies = [{ plan: { title: 'One', texts: ['a'] } }, { plan: { title: 'Unasked', texts: ['x'] } }];
    await sendAgentMessage('one');
    await approvePlan(useStore.getState().activeSessionId, plans()[0].id);
    expect(chatCalls).toBe(2);
    expect(plans().map((p) => p.plan.title)).toEqual(['One']);
    const history = useStore.getState().sessions[useStore.getState().activeSessionId].agent.history;
    expect(history.at(-1)).toMatchObject({ role: 'tool', content: 'Ignored: this reply is text only.' });
  });

  it('no wrap-up when the user already wrote after the plan, or without an LLM', async () => {
    replies = [{ plan: { title: 'One', texts: ['a'] } }];
    await sendAgentMessage('one');
    const sid = useStore.getState().activeSessionId;
    const planId = plans()[0].id;
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [...st.sessions[sid].feed, { id: 'u2', type: 'user', text: 'next', mode: 'agent', attachments: [], workspace: 'chat', createdAt: Date.now() } as never] } } }));
    await approvePlan(sid, planId);
    expect(chatCalls).toBe(1);

    replies = [{ plan: { title: 'Two', texts: ['a'] } }];
    await sendAgentMessage('two');
    const st = useStore.getState();
    useStore.setState({ settings: { ...st.settings, agent: { ...st.settings.agent, provider: 'offline' } } });
    await approvePlan(sid, plans().at(-1)!.id);
    expect(chatCalls).toBe(2);
  });
});
