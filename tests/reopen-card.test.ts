import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { canReopenCard, reopenCard, sendAgentMessage, submitAnswers } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { QuestionsFeedItem } from '../src/engine/types';

type Call = { name: string; args: unknown } | string;
let replies: Call[] = [];
const sid = () => useStore.getState().activeSessionId;
const s = () => useStore.getState().sessions[sid()];

beforeEach(() => {
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    const r = replies.shift() ?? 'ok';
    const chunk = typeof r === 'string'
      ? { choices: [{ delta: { content: r } }] }
      : { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: r.name, arguments: JSON.stringify(r.args) } }] }, finish_reason: 'tool_calls' }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const st = useStore.getState();
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    sessions: { ...st.sessions, [sid()]: { ...st.sessions[sid()], feed: [], editLog: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('editing an earlier answer', () => {
  it('goes back to the card: what came after leaves the chat and the agent context, and it is logged for us', async () => {
    replies = [{ name: 'ask_questions', args: { questions: [{ id: 'who', question: 'Who?', options: ['A gamer', 'A chef'], default: 'A gamer' }] } }];
    await sendAgentMessage('Crea una chica para vender una corneta');
    const card = s().feed.find((f): f is QuestionsFeedItem => f.type === 'questions')!;
    replies = ['Got it.'];
    await submitAnswers(sid(), card.id, { who: 'A gamer' });
    expect(s().feed.at(-1)?.type).toBe('assistant');
    expect(canReopenCard(sid(), card.id)).toBe(true);

    reopenCard(sid(), card.id);
    expect(s().feed.at(-1)?.id).toBe(card.id);
    expect(s().feed.find((f) => f.id === card.id)).toMatchObject({ status: 'pending', answers: { who: 'A gamer' } });
    // The agent's context ends at its own question again: no answer, no reply after it.
    const last = s().agent.history.at(-1)!;
    expect(last.role).toBe('assistant');
    expect(last.tool_calls?.[0].function.name).toBe('ask_questions');
    expect(s().agent.pending).toMatchObject({ kind: 'questions', feedItemId: card.id });
    expect(s().editLog).toEqual([expect.objectContaining({ kind: 'questions', itemId: card.id, before: 'Who?: A gamer', removed: 2 })]);

    replies = ['Now a chef.'];
    await submitAnswers(sid(), card.id, { who: 'A chef' });
    expect(s().agent.history.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n')).toMatch(/Who\?: A chef/);
    expect(String(s().agent.history.filter((m) => m.role === 'tool').map((m) => m.content))).not.toMatch(/A gamer\n/);
  });
});
