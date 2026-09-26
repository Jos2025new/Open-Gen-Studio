import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { PlanFeedItem } from '../src/engine/types';

type Reply = { plan?: { title: string; revision?: boolean; texts: string[] }; text?: string };

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
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    chatCalls++;
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

describe('commenting on a pending plan', () => {
  it('a revision replaces the card, changing only what was asked, in one model call', async () => {
    replies = [{ plan: { title: 'Three', texts: ['a', 'b', 'c'] } }];
    await sendAgentMessage('three clips');
    expect(plans().map((p) => p.status)).toEqual(['awaiting']);
    replies = [{ plan: { title: 'Three', revision: true, texts: ['a', 'B', 'c'] } }];
    await sendAgentMessage('change the second');
    const after = plans();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: 'awaiting', revised: true });
    expect(chatCalls).toBe(2);
    expect(useStore.getState().sessions[useStore.getState().activeSessionId].agent).toMatchObject({ busy: false, revising: undefined });
  });

  it('a different request closes the old plan instead of mixing them', async () => {
    replies = [{ plan: { title: 'Clips', texts: ['a'] } }];
    await sendAgentMessage('clips');
    replies = [{ plan: { title: 'Poster', revision: false, texts: ['p'] } }];
    await sendAgentMessage('now a poster instead');
    expect(plans().map((p) => [p.plan.title, p.status, Boolean(p.revised)])).toEqual([
      ['Clips', 'canceled', false],
      ['Poster', 'awaiting', false],
    ]);
  });

  it('a text answer without a new plan closes the old one (nothing left half-revised)', async () => {
    replies = [{ plan: { title: 'Clips', texts: ['a'] } }];
    await sendAgentMessage('clips');
    replies = [{ text: 'Which model do you mean?' }];
    await sendAgentMessage('use the other one');
    expect(plans().map((p) => p.status)).toEqual(['canceled']);
    expect(useStore.getState().sessions[useStore.getState().activeSessionId].agent.revising).toBeUndefined();
  });
});
