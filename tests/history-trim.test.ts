import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * T6: the results of read_guide / find_models / find_assets used to travel with every later message of the
 * conversation (a follow-up reached 155k input tokens). At the start of a new request each one becomes a line that
 * says what it was, so the prompt stops growing with every turn. Nothing is lost: the tool can be called again.
 */

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { trimReferenceResults } from '../src/engine/agent/attachments';
import { repairHistory, sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { LlmMessage } from '../src/engine/types';

const enc = new TextEncoder();
const line = (x: unknown) => enc.encode(`data: ${JSON.stringify(x)}\n\n`);
const text = (t: string) => ({ choices: [{ delta: { content: t } }] });
let callSeq = 0;
const tool = (name: string, args: unknown) => ({ choices: [{ delta: { tool_calls: [{ index: callSeq++, id: `c_${name}_${callSeq}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
const sse = (chunks: unknown[]) => new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(line(x))); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });

/** What a finished turn leaves in the history: the calls it made and what they answered. */
const historyWith = (calls: Array<[string, unknown, string]>): LlmMessage[] => [
  { role: 'user', content: 'un retrato' },
  { role: 'assistant', content: '', tool_calls: calls.map(([, args], i) => ({ id: `c_${calls[i][0]}`, type: 'function', function: { name: calls[i][0], arguments: JSON.stringify(args) } })) },
  ...calls.map(([, , result]) => ({ role: 'tool' as const, tool_call_id: `c_${calls[0][0]}`, content: result })),
];

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm', showThinking: false } },
    composer: { ...st.composer, agentStyle: 'guided', attachments: [] },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agentMetrics: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
});

describe('the history of a new request (T6)', () => {
  /** A guide as long as the real ones: the twin measured ~9k characters per guide, and the app sends them all. */
  const guide = (n: number) => `workflow:ugc · ${'rules about hooks, shots, staging and claims. '.repeat(n)}`;

  it('turns an earlier guide, model list and library listing into one line each', () => {
    const history = [
      { role: 'user', content: 'quiero un UGC' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_guide', arguments: JSON.stringify({ id: 'workflow:ugc' }) } }] },
      { role: 'tool', tool_call_id: 'c1', content: guide(300) },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'find_models', arguments: JSON.stringify({ query: 'seedance' }) } }] },
      { role: 'tool', tool_call_id: 'c2', content: guide(300) },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c3', type: 'function', function: { name: 'find_assets', arguments: JSON.stringify({ query: 'chica' }) } }] },
      { role: 'tool', tool_call_id: 'c3', content: guide(300) },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c4', type: 'function', function: { name: 'confirm_settings', arguments: JSON.stringify({ kind: 'image' }) } }] },
      { role: 'tool', tool_call_id: 'c4', content: 'Confirmed Nano Banana 2 at 1k, 16:9. Each image step makes 2 images.' },
    ] as LlmMessage[];
    const trimmed = trimReferenceResults(history);
    const toolTexts = (h: LlmMessage[]) => h.filter((m) => m.role === 'tool').map((m) => String(m.content));
    expect(toolTexts(trimmed)).toEqual([
      '[guide workflow:ugc loaded earlier; read_guide again if you need it]',
      '[model list seedance loaded earlier; find_models again if you need it]',
      '[library chica loaded earlier; find_assets again if you need it]',
      // What confirm_settings answered is not a reference: it is the request the agent is acting on.
      'Confirmed Nano Banana 2 at 1k, 16:9. Each image step makes 2 images.',
    ]);
    // The user's own words and the calls stay: the history is still a valid conversation.
    expect(trimmed[0].content).toBe('quiero un UGC');
    expect(trimmed.length).toBe(history.length);
    expect(repairHistory(trimmed).length).toBeGreaterThan(0);
  });

  it('only when it is worth the cache it breaks: below the size, the history travels whole', () => {
    // One guide, as in a conversation that has read one: trimming it would save nothing and cost the cache.
    const small = [
      { role: 'user', content: 'quiero un UGC' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_guide', arguments: JSON.stringify({ id: 'workflow:ugc' }) } }] },
      { role: 'tool', tool_call_id: 'c1', content: guide(20) },
    ] as LlmMessage[];
    expect(trimReferenceResults(small)).toEqual(small);
    // Six guides in one conversation (the case that grew to 155k input tokens) are worth the trade.
    const big = Array.from({ length: 6 }, (_, i) => [
      { role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_guide', arguments: JSON.stringify({ id: `workflow:w${i}` }) } }] },
      { role: 'tool', tool_call_id: `c${i}`, content: guide(200) },
    ]).flat() as LlmMessage[];
    const size = (h: LlmMessage[]) => h.reduce((a, m) => a + (typeof m.content === 'string' ? m.content.length : 0), 0);
    const trimmed = trimReferenceResults(big);
    expect(size(trimmed)).toBeLessThan(size(big) / 2);
    expect(trimmed.every((m) => m.role !== 'tool' || /loaded earlier/.test(String(m.content)))).toBe(true);
  });

  it('a new request trims what came before and leaves what this request reads alone', async () => {
    const sid = useStore.getState().activeSessionId;
    // A finished turn that read the guides it needs: their real text is what crosses the size to be worth trimming.
    const replies = [
      () => sse(['workflow:ugc', 'workflow:product-pack', 'skill:social', 'skill:staged', 'workflow:story'].map((id) => tool('read_guide', { id }))),
      () => sse([text('Vamos con la UGC.')]),
      () => sse([tool('read_guide', { id: 'workflow:ugc' })]),
      () => sse([text('Aquí tienes la idea.')]),
    ];
    const calls: number[] = [];
    let lastMessages: LlmMessage[] = [];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      lastMessages = JSON.parse(String(init?.body)).messages;
      calls.push(lastMessages.length);
      return replies[calls.length - 1]();
    });
    await sendAgentMessage('quiero un UGC para vender la corneta');
    const afterFirst = useStore.getState().sessions[sid].agent.history;
    expect(afterFirst.filter((m) => m.role === 'tool')).toHaveLength(5);

    await sendAgentMessage('ahora en un sofá');
    const history = useStore.getState().sessions[sid].agent.history;
    const tools = history.filter((m) => m.role === 'tool').map((m) => String(m.content));
    // The five guides of the first request are now one line each…
    expect(tools.slice(0, 5)).toEqual([
      '[guide workflow:ugc loaded earlier; read_guide again if you need it]',
      '[guide workflow:product-pack loaded earlier; read_guide again if you need it]',
      '[guide skill:social loaded earlier; read_guide again if you need it]',
      '[guide skill:staged loaded earlier; read_guide again if you need it]',
      '[guide workflow:story loaded earlier; read_guide again if you need it]',
    ]);
    // …and the guide the second request is reading right now is not touched.
    expect(tools[5]).not.toMatch(/loaded earlier/);
    // Every tool call still has its answer, so the history stays valid.
    expect(repairHistory(lastMessages).length).toBe(lastMessages.length);
  });

  it('nothing to trim when the earlier results are already short', () => {
    const history = historyWith([['ask_questions', {}, 'questions: 1']]);
    expect(trimReferenceResults(history)).toEqual(history);
  });
});