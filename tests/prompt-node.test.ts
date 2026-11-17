import { beforeEach, describe, expect, it, vi } from 'vitest';

/* The prompt node: the composer's text as a node, and independent text boxes wired to agents. */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { promptNodeText, promptsWiredToAgent, resolveSystemNodeLive } from '../src/engine/nodes/spec';
import { addSystemNode, ensureSystemNodes, linkSystemNodes } from '../src/engine/nodes/system';
import { createSession, useStore } from '../src/store/store';

let sid = '';
beforeEach(() => {
  const session = createSession('Prompt');
  sid = session.id;
  useStore.setState((st) => ({ activeSessionId: sid, sessions: { ...st.sessions, [sid]: session }, composer: { ...st.composer, text: 'from the box' } }));
  ensureSystemNodes(sid);
});
const node = (id: string) => useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === id)!;

describe('prompt node', () => {
  it("with ref 'composer' its value is composer.text", () => {
    const id = addSystemNode(sid, { type: 'prompt', ref: 'composer' });
    expect(promptNodeText(node(id))).toBe('from the box');
    expect(resolveSystemNodeLive(sid, node(id))).toMatchObject({ type: 'prompt', details: ['from the box'] });
  });
  it('an independent prompt wired to the agent is read through its edge; unwired or composer ones are not added twice', () => {
    const own = addSystemNode(sid, { type: 'prompt', ref: 'note' });
    const comp = addSystemNode(sid, { type: 'prompt', ref: 'composer' });
    expect(promptsWiredToAgent(sid, 'sys_agent')).toEqual([]);
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { ...st.sessions[sid].graph, nodes: st.sessions[sid].graph.nodes.map((n) => n.id === own && n.data.kind === 'ref' ? { ...n, data: { ...n.data, promptText: 'be brief' } } : n) } } } }));
    expect(linkSystemNodes(sid, { source: own, target: 'sys_agent', kind: 'data' }).error).toBeNull();
    expect(linkSystemNodes(sid, { source: comp, target: 'sys_agent', kind: 'data' }).error).toBeNull();
    expect(promptsWiredToAgent(sid, 'sys_agent')).toEqual(['be brief']);
  });
});
