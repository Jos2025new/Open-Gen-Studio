import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Agent names: each new agent gets the next free «Agent N», existing names stay, a chosen one is kept, loading tells
 * repeated defaults apart without touching ids, cables or recipients, renaming goes through the graph layer. */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { distinctTitles, nextAgentTitle, normalizeAgentTitles } from '../src/engine/nodes/agentNames';
import { addSystemNode, ensureSystemNodes } from '../src/engine/nodes/system';
import { patchNodeData } from '../src/engine/flow/actions';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import { createSession, setGraph, useStore } from '../src/store/store';
import type { Graph } from '../src/engine/types';

let sid = '';
const graph = () => useStore.getState().sessions[sid].graph;
const titleOf = (id: string) => graph().nodes.find((n) => n.id === id)?.data.title;
const agent = (id: string, title: string, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'ref' as const, type: 'agent' as const, ref: 'r', title, ...extra } });

beforeEach(() => {
  const session = createSession('Names');
  sid = session.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: session } }));
});

describe('agent names', () => {
  it('numbers each new agent and never renumbers the others', () => {
    ensureSystemNodes(sid);
    expect(titleOf('sys_agent')).toBe('Agent 1');
    const b = addSystemNode(sid, { type: 'agent' });
    const c = addSystemNode(sid, { type: 'agent' });
    expect([titleOf(b), titleOf(c)]).toEqual(['Agent 2', 'Agent 3']);
    setGraph(sid, (g) => ({ ...g, nodes: g.nodes.filter((n) => n.id !== b) }));
    expect(titleOf('sys_agent')).toBe('Agent 1');
    expect(titleOf(c)).toBe('Agent 3');
    expect(titleOf(addSystemNode(sid, { type: 'agent' }))).toBe('Agent 2');
  });

  it('respects an explicit title', () => {
    ensureSystemNodes(sid);
    expect(titleOf(addSystemNode(sid, { type: 'agent', title: 'Director' }))).toBe('Director');
    expect(nextAgentTitle(graph())).toBe('Agent 2');
  });

  it('renames through the graph layer, and undo brings the old name back', () => {
    ensureSystemNodes(sid);
    const steps = graphHistory(sid, 'undo').length;
    expect(patchNodeData(sid, 'sys_agent', { title: 'Writer' })).toBeNull();
    expect(titleOf('sys_agent')).toBe('Writer');
    expect(graphHistory(sid, 'undo').length).toBe(steps + 1);
    travelGraph(sid, graph(), 'undo', 1, (next) => { setGraph(sid, () => next); return true; });
    expect(titleOf('sys_agent')).toBe('Agent 1');
  });

  it('tells the repeated default apart on load, idempotently, touching nothing else', () => {
    const g: Graph = { nodes: [agent('a', 'Agent', { llm: { provider: 'p', model: 'm' } }), agent('b', 'Agent'), agent('c', 'Mine'), agent('d', '')], edges: [{ id: 'e', source: 'a', target: 'b', kind: 'control' } as never] };
    const once = normalizeAgentTitles(g);
    expect(once.nodes.map((n) => n.data.title)).toEqual(['Agent 1', 'Agent 2', 'Mine', 'Agent 3']);
    expect(once.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(once.edges).toBe(g.edges);
    expect(once.nodes[0].data).toMatchObject({ llm: { provider: 'p', model: 'm' }, ref: 'r' });
    expect(normalizeAgentTitles(once)).toBe(once);
    const lone: Graph = { nodes: [agent('a', 'Agent'), agent('c', 'Mine')], edges: [] };
    expect(normalizeAgentTitles(lone)).toBe(lone);
  });

  it('keeps the options of «To» distinct when two manual names coincide', () => {
    const opts = distinctTitles([{ id: 'x', title: 'Bot' }, { id: 'y', title: 'Bot' }, { id: 'z', title: 'Other' }]);
    expect(opts.map((o) => o.label)).toEqual(['Bot (x)', 'Bot (y)', 'Other']);
  });
});
