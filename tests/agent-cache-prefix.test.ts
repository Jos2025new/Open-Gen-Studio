import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Provider prompt caching reuses the longest identical prefix of a request. What the app sends must keep that prefix:
 * the system prompt is the same in every call, a turn only appends to the conversation, and below the trimming
 * threshold (TRIM_MIN_CHARS) earlier messages are not rewritten. Stubbed fetch, nothing reaches a provider.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';

type Call = { name: string; args: unknown };
const enc = new TextEncoder();
const sse = (chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(x)}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
const text = (t: string) => sse([{ choices: [{ delta: { content: t } }] }]);
const tool = (c: Call) => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: c.name, arguments: JSON.stringify(c.args) } }] }, finish_reason: 'tool_calls' }] }]);

let replies: Response[] = [];
let bodies: Array<{ messages: Array<Record<string, unknown>> }> = [];

beforeEach(() => {
  replies = [];
  bodies = [];
  vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    bodies.push(body);
    return replies.shift() ?? text('ok');
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm', showThinking: false } },
    composer: { ...st.composer, agentStyle: 'guided', attachments: [] },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agentMetrics: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

/** Messages without the system prompt, which is sent apart. */
const conversation = (i: number) => bodies[i].messages.slice(1);

describe('the prompt keeps the prefix a provider can cache', () => {
  it('the system prompt is identical in every call, and a turn only appends to the conversation', async () => {
    replies = [tool({ name: 'read_guide', args: { id: 'workflow:story' } }), text('Listo.'), text('Otra vez.')];
    await sendAgentMessage('Quiero un vídeo UGC con este conjunto');
    await sendAgentMessage('Ahora en un sofá');

    expect(bodies.length).toBeGreaterThanOrEqual(3);
    for (const b of bodies) expect(b.messages[0]).toEqual(bodies[0].messages[0]);

    // Within the first request: the call that follows a tool result carries everything the previous call carried.
    expect(conversation(1).slice(0, conversation(0).length)).toEqual(conversation(0));
  });

  it('a new request below the trimming threshold leaves the earlier conversation untouched', async () => {
    replies = [tool({ name: 'read_guide', args: { id: 'workflow:story' } }), text('Listo.'), text('Otra vez.')];
    await sendAgentMessage('Quiero un vídeo UGC con este conjunto');
    const before = conversation(bodies.length - 1);
    await sendAgentMessage('Ahora en un sofá');
    const after = conversation(bodies.length - 1);

    expect(after.slice(0, before.length)).toEqual(before);
  });
});
