import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
  deleteAssetBlobs: async () => undefined,
}));

import { deleteNodes, restoreNodes } from '../src/engine/flow/actions';
import { agentOf, patchLane } from '../src/engine/agent/lanes';
import '../src/engine/agent/runtimeShared';
import { createSession, useStore } from '../src/store/store';
import type { Graph, GraphNode } from '../src/engine/types';

const agent = (id: string): GraphNode => ({ id, position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'agent', ref: 's', title: id } } as unknown as GraphNode);

describe('deleting an agent node and getting it back', () => {
  it('brings its thread back with it (draft, history), not a blank one', () => {
    const entry = { ...createSession('t'), graph: { nodes: [agent('a1'), agent('a2')], edges: [] } as unknown as Graph };
    useStore.setState({ activeSessionId: entry.id, sessions: { [entry.id]: entry }, generations: {} });
    patchLane(entry.id, 'a2', { history: [{ role: 'user', content: 'remember me' }] });
    const gone = useStore.getState().sessions[entry.id].graph.nodes.filter((n) => n.id === 'a2');
    expect(deleteNodes(entry.id, ['a2'])).toBeNull();
    expect(agentOf(entry.id, 'a2').history).toEqual([]);
    expect(restoreNodes(entry.id, { nodes: gone, edges: [] }).error).toBeNull();
    expect(agentOf(entry.id, 'a2').history[0]?.content).toBe('remember me');
  });

  it('keeps every thread the undo history can still bring back, however many agents are deleted', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `x${i}`);
    const entry = { ...createSession('many'), graph: { nodes: ids.map(agent), edges: [] } as unknown as Graph };
    useStore.setState({ activeSessionId: entry.id, sessions: { [entry.id]: entry }, generations: {} });
    for (const id of ids) patchLane(entry.id, id, { history: [{ role: 'user', content: `mem ${id}` }] });
    const nodes = useStore.getState().sessions[entry.id].graph.nodes;
    for (const id of ids) { const g = useStore.getState().sessions[entry.id].graph; expect(deleteNodes(entry.id, [id])).toBeNull(); void g; }
    expect(restoreNodes(entry.id, { nodes: nodes.filter((n) => n.id === 'x0'), edges: [] }).error).toBeNull();
    expect(agentOf(entry.id, 'x0').history[0]?.content).toBe('mem x0');
  });
});
