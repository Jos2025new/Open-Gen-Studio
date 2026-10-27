import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';

const sse = (text: string) => {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
};

let chatCalls = 0;
let sent: Array<{ role: string; content: unknown }> = [];

beforeEach(() => {
  chatCalls = 0;
  sent = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    chatCalls++;
    sent = body.messages;
    return sse('ok');
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'direct', attachments: [] },
    sessions: {
      ...st.sessions,
      [sid]: {
        ...st.sessions[sid],
        // A settings card waiting for confirmation, opened without a tool call id.
        feed: [{ id: 'set1', type: 'settings', workspace: 'chat', status: 'pending', sections: [] } as never],
        agent: { history: [], questionRound: 0, notes: [], busy: false, pending: { kind: 'settings', feedItemId: 'set1' } } as never,
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('typing while the settings card is open', () => {
  it('without a tool call id, tells the LLM the message wrote instead of confirming the card, with the user text', async () => {
    await sendAgentMessage('make it 9:16 instead');
    expect(chatCalls).toBe(1);
    // The last message the model receives is the card reply.
    const last = sent[sent.length - 1];
    const content = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
    expect(content).toContain('instead of confirming the settings card');
    expect(content).toContain('make it 9:16 instead');
  });
});
