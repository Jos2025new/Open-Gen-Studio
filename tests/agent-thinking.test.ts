import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { chat, reasoningBody } from '../src/engine/providers/llm';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { ActivityFeedItem } from '../src/engine/types';

const enc = new TextEncoder();
const sse = (chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(x)}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
const tool = (name: string, args: unknown) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
const think = (t: string) => ({ choices: [{ delta: { reasoning: t } }] });
const usage = { usage: { prompt_tokens: 8000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 6000 }, completion_tokens_details: { reasoning_tokens: 250 } }, choices: [] };

afterEach(() => vi.unstubAllGlobals());

describe('reasoning effort and thinking per provider (L1–L2)', () => {
  it('NanoGPT gets reasoning_effort and, to show thinking, exclude false; Atlas gets nothing', () => {
    expect(reasoningBody('nanogpt', 'low', true)).toEqual({ reasoning_effort: 'low', reasoning: { exclude: false } });
    expect(reasoningBody('nanogpt', 'none', false)).toEqual({ reasoning_effort: 'none' });
    expect(reasoningBody('nanogpt', undefined, false)).toEqual({});
    expect(reasoningBody('openrouter', 'high', false)).toEqual({ reasoning: { effort: 'high', exclude: true } });
    expect(reasoningBody('openrouter', 'none', true)).toEqual({ reasoning: { enabled: false, exclude: true } });
    expect(reasoningBody('atlas', 'low', true)).toEqual({});
  });

  it('streams the reasoning, times the call and reads reasoning and cached tokens', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return sse([think('The user wants '), { choices: [{ delta: { reasoning_content: 'three clips.' } }] }, tool('propose_plan', { title: 'x' }), usage]);
    });
    const seen: string[] = [];
    const res = await chat({ provider: 'nanogpt', apiKey: 'k', model: 'm', system: 's', messages: [], tools: [], effort: 'low', showReasoning: true, signal: new AbortController().signal, onReasoning: (_d, full) => seen.push(full) });
    expect(body).toMatchObject({ reasoning_effort: 'low', reasoning: { exclude: false } });
    expect(seen.at(-1)).toBe('The user wants three clips.');
    expect(res.usage).toMatchObject({ reasoningTokens: 250, cachedTokens: 6000 });
    expect(res.timing.reasoningMs).toBeLessThanOrEqual(res.timing.outputMs!);
    expect(res.timing.ttfbMs).toBeLessThanOrEqual(res.timing.totalMs);
  });

  it('a model that refuses the reasoning fields is asked again without them, once', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) return new Response(JSON.stringify({ error: { message: 'reasoning_effort is not supported for this model' } }), { status: 400 });
      return sse([{ choices: [{ delta: { content: 'hi' } }] }]);
    });
    const res = await chat({ provider: 'nanogpt', apiKey: 'k', model: 'm', system: 's', messages: [], tools: [], effort: 'low', signal: new AbortController().signal });
    expect(res.text).toBe('hi');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');
  });
});

describe('activity block of a turn (L3–L4)', () => {
  beforeEach(() => {
    const st = useStore.getState();
    const sid = st.activeSessionId;
    useStore.setState({
      settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm', effort: 'low', showThinking: true } },
      composer: { ...st.composer, agentStyle: 'guided', attachments: [] },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agentMetrics: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
    });
  });

  it('shows the reasoning, the guide it read and the plan it drafted, and times each call', async () => {
    const replies = [
      [think('A story with a recurring character: '), think('load the story workflow.'), tool('read_guide', { id: 'workflow:story' }), usage],
      [think('Three beats.'), tool('propose_plan', { title: 'Turno de guardia', steps: [{ id: 't1', kind: 'text', text: 'ok' }] }), usage],
    ];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (!body.messages) return new Response(JSON.stringify({ data: [] }));
      return sse(replies.shift() ?? []);
    });
    await sendAgentMessage('una historia de 3 clips');
    await new Promise((r) => setTimeout(r, 200)); // throttled reasoning updates land
    const sid = useStore.getState().activeSessionId;
    const feed = useStore.getState().sessions[sid].feed;
    const act = feed.find((f): f is ActivityFeedItem => f.type === 'activity')!;
    expect(act.endedAt).toBeGreaterThanOrEqual(act.startedAt);
    expect(act.entries.map((e) => (e.kind === 'thinking' ? `thinking:${e.text}` : `${e.icon}:${e.label}`))).toEqual([
      'thinking:A story with a recurring character: load the story workflow.',
      'guide:Read the Story / series workflow',
      'thinking:Three beats.',
      'plan:Drafted the plan',
    ]);
    // The activity block comes before the plan card it led to.
    expect(feed.findIndex((f) => f.type === 'activity')).toBeLessThan(feed.findIndex((f) => f.type === 'plan'));
    const metrics = useStore.getState().sessions[sid].agentMetrics!.at(-1)!;
    expect(metrics.callTimings).toHaveLength(2);
    expect(metrics.callTimings![0]).toMatchObject({ reasoningTokens: 250, cachedTokens: 6000 });
  });
});
