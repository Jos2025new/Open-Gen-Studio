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
}));

import { chat, type ToolSpec } from '../src/engine/providers/llm';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';

import { mainThread } from './helpers/threads';
const enc = new TextEncoder();
const sse = (chunks: unknown[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const x of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(x)}\n\n`));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );

const sampleTools: ToolSpec[] = [
  { type: 'function', function: { name: 'first_tool', description: 'First', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'last_tool', description: 'Last', parameters: { type: 'object', properties: {} } } },
];

const countBreakpoints = (obj: unknown): number => {
  const matches = JSON.stringify(obj).match(/"cache_control":\{"type":"ephemeral"\}/g);
  return matches ? matches.length : 0;
};

afterEach(() => vi.unstubAllGlobals());

describe('prompt caching for Anthropic models', () => {
  it.each(['anthropic/claude-haiku-5.5', 'claude-sonnet-4-5'])(
    'adds ephemeral cache_control breakpoints on the system block and the last user message for %s',
    async (model) => {
      let body: Record<string, unknown> = {};
      vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return sse([{ choices: [{ delta: { content: 'ok' } }] }]);
      });
      await chat({
        provider: 'openrouter',
        apiKey: 'k',
        model,
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'hi' }],
        tools: sampleTools,
        signal: new AbortController().signal,
      });
      const msgs = body.messages as Array<{ role: string; content: unknown }>;
      expect(msgs[0]).toEqual({
        role: 'system',
        content: [{ type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } }],
      });
      expect(msgs[1]).toEqual({ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] });
      expect(JSON.stringify(body.tools)).not.toContain('cache_control');
      expect(countBreakpoints(body)).toBe(2);
      expect(countBreakpoints(body)).toBeLessThanOrEqual(4);
      expect(sampleTools[1]).not.toHaveProperty('cache_control');
    },
  );

  it.each([
    { provider: 'openrouter' as const, model: 'openai/gpt-6-luna' },
    { provider: 'nanogpt' as const, model: 'deepseek/deepseek-v4.1-flash' },
  ])('leaves non-Anthropic model $model without cache_control', async ({ provider, model }) => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return sse([{ choices: [{ delta: { content: 'ok' } }] }]);
    });
    await chat({
      provider,
      apiKey: 'k',
      model,
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
      tools: sampleTools,
      signal: new AbortController().signal,
    });
    const msgs = body.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });

  it.each([
    { label: 'prompt_tokens_details.cached_tokens', usage: { prompt_tokens: 35000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 32000 } }, expected: 32000 },
    { label: 'cache_read_input_tokens', usage: { prompt_tokens: 35000, completion_tokens: 100, cache_read_input_tokens: 28000 }, expected: 28000 },
    { label: 'input_tokens_details.cached_tokens', usage: { prompt_tokens: 35000, completion_tokens: 100, input_tokens_details: { cached_tokens: 24000 } }, expected: 24000 },
  ])('parses cached tokens from $label', async ({ usage, expected }) => {
    vi.stubGlobal('fetch', async () => sse([{ choices: [{ delta: { content: 'ok' } }] }, { usage, choices: [] }]));
    const res = await chat({
      provider: 'openrouter',
      apiKey: 'k',
      model: 'anthropic/claude-haiku-5.5',
      system: 's',
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    });
    expect(res.usage?.cachedTokens).toBe(expected);
  });
});

describe('agent turn prefix stability across calls', () => {
  beforeEach(() => {
    const st = useStore.getState();
    const sid = st.activeSessionId;
    useStore.setState({
      settings: {
        ...st.settings,
        keys: { ...st.settings.keys, openrouter: 'k' },
        agent: { ...st.settings.agent, provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', showThinking: false },
      },
      composer: { ...st.composer, agentStyle: 'direct', attachments: [] },
      sessions: {
        ...st.sessions,
        [sid]: { ...st.sessions[sid], feed: [], agentMetrics: [], agents: mainThread({ history: [], questionRound: 0, notes: [], busy: false }) },
      },
    });
  });

  it('keeps system prompt, tools, and initial user prefix byte-identical across two calls in one session', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const replies = [
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_guide', arguments: JSON.stringify({ id: 'workflow:story' }) } }] }, finish_reason: 'tool_calls' }] }],
      [{ choices: [{ delta: { content: 'Ready to help.' } }] }],
    ];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      const parsed = init?.body ? JSON.parse(String(init.body)) : {};
      if (!parsed.messages) return new Response(JSON.stringify({ data: [] }));
      bodies.push(parsed);
      return sse(replies.shift() ?? []);
    });

    await sendAgentMessage('tell me a short story');

    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[0].tools)).toBe(JSON.stringify(bodies[1].tools));
    expect(JSON.stringify((bodies[0].messages as unknown[])[0])).toBe(JSON.stringify((bodies[1].messages as unknown[])[0]));
    expect(JSON.stringify((bodies[0].messages as unknown[]).slice(0, 2))).toBe(JSON.stringify((bodies[1].messages as unknown[]).slice(0, 2)));
  });
});
