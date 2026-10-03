import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { sendAgentMessage, stopAgent } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';

import { newSession } from '../src/store/store';

const enc = new TextEncoder();
const line = (x: unknown) => enc.encode(`data: ${JSON.stringify(x)}\n\n`);
/** A provider that streams nothing until aborted. */
const hang = (signal?: AbortSignal) =>
  new Response(new ReadableStream({
    start(c) {
      c.enqueue(line({ choices: [{ delta: {} }] }));
      signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
const tick = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  const st = useStore.getState();
  useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm', showThinking: false } } });
});

describe('agent cancellation is per session', () => {
  it('Stop in one session leaves the other turn running, and a finished turn does not unhook another', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      if (!String(u).includes('chat/completions')) return new Response('{}', { status: 404 });
      signals.push(init!.signal!);
      return hang(init!.signal!);
    });
    const a = useStore.getState().activeSessionId;
    const turnA = sendAgentMessage('hola A');
    await tick();
    const b = newSession();
    useStore.setState({ activeSessionId: b });
    const turnB = sendAgentMessage('hola B');
    await tick();
    expect(signals).toHaveLength(2);

    stopAgent(b); // Stop in B
    await turnB;
    expect(signals[1].aborted).toBe(true);
    expect(signals[0].aborted).toBe(false);
    expect(useStore.getState().sessions[a].agent.busy).toBe(true);

    stopAgent(a); // A can still be stopped after B finished
    await turnA;
    expect(signals[0].aborted).toBe(true);
    expect(useStore.getState().sessions[a].agent.busy).toBe(false);
    vi.unstubAllGlobals();
  });
});
