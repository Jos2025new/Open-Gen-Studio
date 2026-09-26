import { afterEach, describe, expect, it, vi } from 'vitest';
import { chat } from '../src/engine/providers/llm';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

afterEach(() => vi.unstubAllGlobals());

const sse = (chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(x)}\n\n`)); c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });

describe('agent status signals', () => {
  it('announces the plan once, at its first tool-call fragment, without changing the request', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return sse([
        { choices: [{ delta: { content: 'Ok.' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'propose_plan', arguments: '{"ti' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tle":"x"}' } }] }, finish_reason: 'tool_calls' }] },
      ]);
    });
    const order: string[] = [];
    const res = await chat({ provider: 'nanogpt', apiKey: 'k', model: 'm', system: 's', messages: [], tools: [], signal: new AbortController().signal, onText: () => order.push('text'), onToolCall: () => order.push('tool') });
    expect(order).toEqual(['text', 'tool']);
    expect(res.toolCalls[0]).toMatchObject({ name: 'propose_plan', arguments: '{"title":"x"}' });
    // The indicator asks nothing more of the model: no reasoning request is added.
    expect(body).not.toHaveProperty('reasoning');
  });
});
