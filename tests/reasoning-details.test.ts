import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { chat } from '../src/engine/providers/llm';
import type { LlmMessage } from '../src/engine/types';

const enc = new TextEncoder();
const sse = (chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(x)}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });

/** Frozen OpenRouter stream: two reasoning blocks in one order, then a tool call. Kept verbatim on purpose. */
const DETAILS_A = { type: 'reasoning.text', text: 'Plan the shots', format: 'unknown', index: 0 };
const DETAILS_B = { type: 'reasoning.encrypted', data: 'opaque==', format: 'unknown', index: 1 };
const frozenStream = () =>
  sse([
    { choices: [{ delta: { reasoning_details: [DETAILS_A] } }] },
    { choices: [{ delta: { reasoning_details: [DETAILS_B] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'propose_plan', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] },
  ]);

afterEach(() => vi.unstubAllGlobals());

describe('reasoning_details round trip (fix 5a)', () => {
  it('keeps the streamed blocks in order and sends them back with the assistant message', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? frozenStream() : sse([{ choices: [{ delta: { content: 'done' } }] }]);
    });
    const first = await chat({ provider: 'openrouter', apiKey: 'k', model: 'm', system: 's', messages: [{ role: 'user', content: 'go' }], tools: [], signal: new AbortController().signal });
    expect(first.reasoningDetails).toEqual([DETAILS_A, DETAILS_B]);

    // The runtime stores the assistant turn with those blocks, then continues after the tool result.
    const history: LlmMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'propose_plan', arguments: '{}' } }], reasoning_details: first.reasoningDetails },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
    ];
    await chat({ provider: 'openrouter', apiKey: 'k', model: 'm', system: 's', messages: history, tools: [], signal: new AbortController().signal });
    const sent = bodies[1].messages as LlmMessage[];
    expect(sent[2]).toMatchObject({ role: 'assistant', reasoning_details: [DETAILS_A, DETAILS_B] });
  });

  it('other providers never receive reasoning_details', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return sse([{ choices: [{ delta: { content: 'hi' } }] }]);
    });
    await chat({
      provider: 'nanogpt',
      apiKey: 'k',
      model: 'm',
      system: 's',
      messages: [{ role: 'assistant', content: 'x', reasoning_details: [DETAILS_A] }],
      tools: [],
      signal: new AbortController().signal,
    });
    expect((body.messages as LlmMessage[])[1]).not.toHaveProperty('reasoning_details');
  });

  it('a session saved without the field still sends its messages unchanged', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return sse([{ choices: [{ delta: { content: 'hi' } }] }]);
    });
    const old: LlmMessage = { role: 'assistant', content: 'earlier answer' };
    await chat({ provider: 'openrouter', apiKey: 'k', model: 'm', system: 's', messages: [old], tools: [], signal: new AbortController().signal });
    expect((body.messages as LlmMessage[])[1]).toEqual(old);
  });
});

describe('reasoning refusal is not silent (fix 5b)', () => {
  it('tells the user when the retry drops the reasoning settings', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: 'reasoning effort is not supported' } }), { status: 400 });
      return sse([{ choices: [{ delta: { content: 'ok' } }] }]);
    });
    const notes: string[] = [];
    const res = await chat({ provider: 'openrouter', apiKey: 'k', model: 'm', system: 's', messages: [], tools: [], effort: 'high', signal: new AbortController().signal, onNotice: (t) => notes.push(t) });
    expect(res.text).toBe('ok');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/OpenRouter refused the reasoning setting/);
  });

  it('a 400 that is not about reasoning is not retried and not noted', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'bad image' } }), { status: 400 }));
    const notes: string[] = [];
    await expect(chat({ provider: 'openrouter', apiKey: 'k', model: 'm', system: 's', messages: [], tools: [], effort: 'high', signal: new AbortController().signal, onNotice: (t) => notes.push(t) })).rejects.toThrow();
    expect(notes).toEqual([]);
  });
});
