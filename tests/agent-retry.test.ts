import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { retryAgentTurn, sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { NoticeFeedItem } from '../src/engine/types';

const enc = new TextEncoder();
const line = (x: unknown) => enc.encode(`data: ${JSON.stringify(x)}\n\n`);
const text = (t: string) => ({ choices: [{ delta: { content: t } }] });
const tool = (name: string, args: unknown) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
// A stream that starts answering and then loses the connection, as Chrome reports it ("network error").
const dropped = (chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(line(x))); }, pull(c) { c.error(new TypeError('network error')); } }), { headers: { 'content-type': 'text/event-stream' } });
const sse = (chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(line(x))); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });

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

describe('retry after a dropped connection', () => {
  it('names the lost connection, offers Retry, and repeats only the failed call', async () => {
    const calls: number[] = [];
    const replies = [
      () => sse([tool('read_guide', { id: 'workflow:story' })]),
      () => dropped([text('¡Buena elección! Aquí va la idea: una chica joven… y acerc')]),
      () => sse([text('¡Buena elección! Aquí va la idea completa.')]),
    ];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)).messages.length);
      return replies[calls.length - 1]();
    });
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('un vídeo UGC con este conjunto');

    let feed = useStore.getState().sessions[sid].feed;
    const note = feed.at(-1) as NoticeFeedItem;
    expect(note.type).toBe('notice');
    expect(note.text).toBe('NanoGPT: connection lost mid-response (network error)');
    expect(note.retry?.partialItemId).toBeTruthy();
    expect(feed.some((f) => f.type === 'assistant' && f.text.includes('y acerc'))).toBe(true);

    await retryAgentTurn(sid, note.id);
    feed = useStore.getState().sessions[sid].feed;
    // The half answer and the error are gone; the finished answer is there once.
    expect(feed.some((f) => f.type === 'notice')).toBe(false);
    expect(feed.filter((f) => f.type === 'assistant').map((f) => f.type === 'assistant' && f.text)).toEqual(['¡Buena elección! Aquí va la idea completa.']);
    // The guide read before the failure stays in the history: the retry sends the same messages as the failed call.
    expect(calls).toHaveLength(3);
    expect(calls[2]).toBe(calls[1]);
  });

  it('errors that retrying cannot fix (a bad key) offer no Retry', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }));
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('hola');
    const note = useStore.getState().sessions[sid].feed.at(-1) as NoticeFeedItem;
    expect(note.type).toBe('notice');
    expect(note.retry).toBeUndefined();
  });
});
