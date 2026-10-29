import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { QuestionsFeedItem } from '../src/engine/types';

// Repro (case 4, H10): typing in the Composer while a questions card is open. The card shows the recommended option as
// selected; typing must not drop it. (A selection the user clicked lives in QuestionsCard's React state, so only the
// shown recommended value is reproducible here; the clicked-selection variant is NOT reproducible below the UI.)
type Call = { name: string; args: unknown } | string;
let replies: Call[] = [];
let bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
const sid = () => useStore.getState().activeSessionId;
const s = () => useStore.getState().sessions[sid()];

beforeEach(() => {
  bodies = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    bodies.push(body);
    const r = replies.shift() ?? 'ok';
    const chunk = typeof r === 'string' ? { choices: [{ delta: { content: r } }] } : { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: r.name, arguments: JSON.stringify(r.args) } }] }, finish_reason: 'tool_calls' }] };
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

describe('repro 4 / H10: typing with a questions card open', () => {
  // Cause: conversation.ts:51-54 submits only { note } (typed), so the recommended default shown selected becomes "(no answer)" (conversation.ts:183).
  it.fails('the recommended option the card showed selected still reaches the agent', async () => {
    replies = [{ name: 'ask_questions', args: { questions: [{ id: 'who', question: 'Who?', options: ['A gamer', 'A chef'], default: 'A gamer' }] } }];
    await sendAgentMessage('Crea una chica para vender una corneta');
    const card = s().feed.find((f): f is QuestionsFeedItem => f.type === 'questions')!;
    expect(card.status).toBe('pending');
    replies = ['ok'];
    await sendAgentMessage('que sea mayor de 40');
    const seen = JSON.stringify(bodies.at(-1)!.messages.at(-1));
    expect(seen).toContain('que sea mayor de 40');
    expect(seen).not.toContain('(no answer)');
  });
});
