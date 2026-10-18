// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
// Nothing reaches a provider: the turn that follows an accepted send never resolves.
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat: vi.fn(() => new Promise(() => {})) }));

import { agentAccepts } from '../src/engine/agent/sendGate';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { newSession, setUi, useStore } from '../src/store/store';

const setBusy = (busy: boolean) => useStore.setState((s) => ({ sessions: { ...s.sessions, [s.activeSessionId]: { ...s.sessions[s.activeSessionId], agent: { ...s.sessions[s.activeSessionId].agent, busy } } } }));
const feedCount = () => useStore.getState().sessions[useStore.getState().activeSessionId]?.feed.length ?? 0;

describe('sendAgentMessage uses agentAccepts()', () => {
  beforeEach(() => {
    setUi({ home: false });
    newSession();
    setBusy(false);
  });

  it('refuses exactly when agentAccepts() is false: missing session', () => {
    useStore.setState({ activeSessionId: 'no-such-session' });
    expect(agentAccepts()).toBe(false);
    const before = Object.keys(useStore.getState().sessions).length;
    void sendAgentMessage('hola');
    expect(Object.keys(useStore.getState().sessions).length).toBe(before);
    expect(useStore.getState().sessions['no-such-session']).toBeUndefined();
  });

  it('refuses exactly when agentAccepts() is false: busy session', () => {
    setBusy(true);
    expect(agentAccepts()).toBe(false);
    const before = feedCount();
    void sendAgentMessage('hola');
    expect(feedCount()).toBe(before);
  });

  it('proceeds exactly when agentAccepts() is true', () => {
    expect(agentAccepts()).toBe(true);
    const before = feedCount();
    void sendAgentMessage('hola');
    expect(feedCount()).toBeGreaterThan(before);
  });
});
