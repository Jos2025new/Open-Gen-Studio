import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Opening or undocking a Space shows its system nodes; the ordinary Nodes canvas never does (user rule 2026-11-17). */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { ensureOmniNodes, omniSpaceNodeId, ordinaryGraph, setSpaceView, showSpaceSystemNodes } from '../src/engine/nodes/omni';
import { deleteNodes } from '../src/engine/flow/actions';
import { createSession, useStore } from '../src/store/store';

let sid = '';
const graph = () => useStore.getState().sessions[sid].graph;
const has = (type: string) => graph().nodes.some((n) => n.data.kind === 'ref' && n.data.type === type);
beforeEach(() => {
  const session = createSession('Open space');
  sid = session.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: session } }));
  ensureOmniNodes(sid);
});

describe('opening a Space', () => {
  it("brings back the system nodes Studio needs (chat, agent, model) when they were missing, linked to it", () => {
    const chat = graph().nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'chat')!;
    expect(deleteNodes(sid, [chat.id])).toBeNull();
    expect(has('chat')).toBe(false);
    expect(setSpaceView(sid, omniSpaceNodeId('studio'), 'node')).toBeNull();
    expect(has('chat')).toBe(true);
    const chatNow = graph().nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'chat')!;
    expect(graph().edges.some((e) => [e.source, e.target].includes(chatNow.id) && [e.source, e.target].includes(omniSpaceNodeId('studio')))).toBe(true);
  });
  it('is idempotent: nothing is added when every part is already there', () => {
    expect(showSpaceSystemNodes(sid, 'studio')).toEqual([]);
  });
  it('the ordinary Nodes canvas still shows none of them', () => {
    setSpaceView(sid, omniSpaceNodeId('designer'), 'node');
    expect(ordinaryGraph(graph()).nodes.filter((n) => n.data.kind === 'ref')).toEqual([]);
  });
});
