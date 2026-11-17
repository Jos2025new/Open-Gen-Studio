import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { agentEngine, chatAgents, chatNodeOf, engineLabel, feedOfChat, messageMeta } from '../src/engine/agent/runtimeShared';
import { addSystemNode, ensureSystemNodes, linkSystemNodes, setAgentLlm } from '../src/engine/nodes/system';
import { createSession, useStore } from '../src/store/store';

let sid = '';
beforeEach(() => {
  const s = createSession('Adversarial agents'); sid = s.id; const st = useStore.getState();
  useStore.setState({ activeSessionId: sid, sessions: { ...st.sessions, [sid]: s }, settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'k', atlas: 'k' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'default/model' } } });
  ensureSystemNodes(sid);
});

describe('adversarial agent/chat ownership', () => {
  it('an unknown sender ID is not silently attributed to the first agent', () => {
    expect(messageMeta('chat', { agentNodeId: 'deleted-agent' })).not.toHaveProperty('agentNodeId', 'sys_agent');
  });
  it('a chat with two agents preserves distinct engines and sender metadata', () => {
    const second = addSystemNode(sid, { type: 'agent', ref: sid });
    expect(linkSystemNodes(sid, { source: chatNodeOf(sid)!, target: 'sys_agent', kind: 'control' }).error).toBeNull();
    expect(linkSystemNodes(sid, { source: chatNodeOf(sid)!, target: second, kind: 'control' }).error).toBeNull();
    setAgentLlm(sid, 'sys_agent', { provider: 'openrouter', model: 'first/model' });
    setAgentLlm(sid, second, { provider: 'atlas', model: 'second/model' });
    expect(chatAgents(sid)).toEqual(['sys_agent', second]);
    expect(agentEngine(sid, 'sys_agent')).toMatchObject({ provider: 'openrouter', model: 'first/model' });
    expect(agentEngine(sid, second)).toMatchObject({ provider: 'atlas', model: 'second/model' });
    expect(messageMeta('chat', { agentNodeId: second })).toMatchObject({ agentNodeId: second, provider: 'atlas', model: 'second/model' });
  });
  it('legacy chat migration retains exact feed cardinality and unique message IDs', () => {
    const old = Array.from({ length: 37 }, (_, i) => ({ id: `legacy-${i}`, type: i % 2 ? 'assistant' : 'user', text: `message-${i}`, createdAt: i }));
    useStore.setState(st => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: old as never } } }));
    ensureSystemNodes(sid);
    const chatId = chatNodeOf(sid)!;
    const owned = feedOfChat(sid, chatId);
    expect(owned).toHaveLength(old.length);
    expect(new Set(owned.map(x => x.id)).size).toBe(old.length);
    expect(owned.map(x => x.id)).toEqual(old.map(x => x.id));
  });
  it('two chat feeds never show each other messages', () => {
    const first = chatNodeOf(sid)!;
    const second = addSystemNode(sid, { type: 'chat', ref: sid });
    const items = [
      { id: 'first-only', type: 'user', text: 'one', createdAt: 1, meta: { chatNodeId: first } },
      { id: 'second-only', type: 'user', text: 'two', createdAt: 2, meta: { chatNodeId: second } },
    ];
    useStore.setState(st => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: items as never } } }));
    expect(feedOfChat(sid, first).map(x => x.id)).toEqual(['first-only']);
    expect(feedOfChat(sid, second).map(x => x.id)).toEqual(['second-only']);
  });
  it('the displayed engine label follows the selected provider/model pair', () => {
    useStore.setState(st => ({ settings: { ...st.settings, agent: { ...st.settings.agent, provider: 'atlas', model: 'vendor/real-model' } } }));
    expect(engineLabel()).toMatch(/real-model.*Atlas/i);
  });
});
