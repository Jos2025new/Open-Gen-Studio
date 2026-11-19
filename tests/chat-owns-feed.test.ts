import { beforeEach, describe, expect, it, vi } from 'vitest';

/* The chat node owns its feed and several agents can share it; old sessions keep every message. */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { agentEngine, chatAgents, chatNodeOf, feedOfChat, messageMeta } from '../src/engine/agent/runtimeShared';
import { addSystemNode, ensureSystemNodes, linkSystemNodes, setAgentLlm } from '../src/engine/nodes/system';
import { createSession, useStore } from '../src/store/store';

let sid = '';
beforeEach(() => {
  const session = createSession('Chat feed');
  sid = session.id;
  const st = useStore.getState();
  useStore.setState({ activeSessionId: sid, sessions: { ...st.sessions, [sid]: session },
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'k', atlas: 'k' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'global/model' } } });
});

describe('chat node owns its feed', () => {
  it('an existing session (no chatNodeId on any message) keeps every message in its first chat, none lost', () => {
    const old = [{ id: 'a', type: 'user', text: 'hi', createdAt: 1 }, { id: 'b', type: 'assistant', text: 'hello', createdAt: 2, meta: { agent: 'Director' } }];
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: old as never } } }));
    ensureSystemNodes(sid);
    const chat = chatNodeOf(sid)!;
    expect(feedOfChat(sid, chat).map((f) => f.id)).toEqual(['a', 'b']);
    expect(useStore.getState().sessions[sid].feed).toHaveLength(2);
  });
  it('a second chat node only owns what is written to it', () => {
    ensureSystemNodes(sid);
    const second = addSystemNode(sid, { type: 'chat', ref: sid });
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [{ id: 'x', type: 'user', text: 'one', createdAt: 1 }, { id: 'y', type: 'user', text: 'two', createdAt: 2, meta: { chatNodeId: second } }] as never } } }));
    expect(feedOfChat(sid, chatNodeOf(sid)!).map((f) => f.id)).toEqual(['x']);
    expect(feedOfChat(sid, second).map((f) => f.id)).toEqual(['y']);
  });
  it('several agents share a chat; each message names its sender, provider and model', () => {
    ensureSystemNodes(sid);
    const second = addSystemNode(sid, { type: 'agent', ref: sid });
    expect(linkSystemNodes(sid, { source: chatNodeOf(sid)!, target: second, kind: 'control' }).error).toBeNull();
    expect(chatAgents(sid)).toEqual(expect.arrayContaining(['sys_agent', second]));
    setAgentLlm(sid, second, { provider: 'atlas', model: 'second/model' });
    expect(agentEngine(sid, second)).toMatchObject({ provider: 'atlas', model: 'second/model' });
    expect(agentEngine(sid, 'sys_agent')).toMatchObject({ model: 'global/model' });
    expect(messageMeta('chat', { agentNodeId: second }, sid, 'main')).toMatchObject({ agentNodeId: second, provider: 'atlas', model: 'second/model', chatNodeId: chatNodeOf(sid) });
  });
});
