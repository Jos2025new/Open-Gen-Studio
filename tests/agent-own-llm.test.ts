import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Each agent node can have its own provider and model; the global is only the default; messages say who wrote them. */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { agentEngine, messageMeta } from '../src/engine/agent/runtimeShared';
import { ensureSystemNodes, setAgentLlm } from '../src/engine/nodes/system';
import { createSession, useStore } from '../src/store/store';

let sid = '';
beforeEach(() => {
  const session = createSession('Agent llm');
  sid = session.id;
  const st = useStore.getState();
  useStore.setState({ activeSessionId: sid, sessions: { ...st.sessions, [sid]: session },
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'k', atlas: 'k' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'global/model' } } });
  ensureSystemNodes(sid);
});

describe('agent node with its own LLM', () => {
  it('without its own choice it follows the global default (nothing to migrate)', () => {
    expect(agentEngine()).toMatchObject({ provider: 'openrouter', model: 'global/model' });
  });
  it('its own provider and model win over the global one, and removing them goes back to the default', () => {
    expect(setAgentLlm(sid, 'sys_agent', { provider: 'atlas', model: 'own/model' })).toBeNull();
    expect(agentEngine()).toMatchObject({ provider: 'atlas', model: 'own/model' });
    expect(agentEngine(sid)).toMatchObject({ provider: 'atlas' });
    setAgentLlm(sid, 'sys_agent', null);
    expect(agentEngine()).toMatchObject({ model: 'global/model' });
  });
  it('messages carry the agent node id, keeping the visible role', () => {
    setAgentLlm(sid, 'sys_agent', { provider: 'atlas', model: 'own/model' });
    expect(messageMeta('chat')).toMatchObject({ agent: 'Director', agentNodeId: 'sys_agent', provider: 'atlas', model: 'own/model' });
  });
});
