import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }); });
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
import { useStore, createSession } from '../src/store/store';
import { runProblems } from '../src/engine/nodecore/guard';
import { inspectNode } from '../src/engine/nodecore/inspect';
import { resolveInputs, storeEnv } from '../src/engine/nodecore/resolver';
import { deleteNodesWithUndo, restoreNodes } from '../src/engine/flow/actions';
import type { Graph } from '../src/engine/types';

let sid: string;
const g = () => useStore.getState().sessions[sid].graph;
beforeEach(() => {
  const entry = { ...createSession('s'), graph: { nodes: [
    { id: 'op', position: { x: 0, y: 0 }, data: { kind: 'tool', title: 'Split', op: 'grid_split', params: { grid: 2 }, outputIndex: 0 } },
    { id: 't1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 't1', prompt: '', modelRef: 'local::image', settings: { count: 1, advanced: {} }, outputIndex: 0 } },
  ], edges: [{ id: 'e1', source: 't1', target: 'op', sourceHandle: 'out', targetHandle: 'input' }] } as unknown as Graph };
  sid = entry.id; useStore.setState({ activeSessionId: sid, sessions: { [sid]: entry }, generations: {} });
});

describe('a source the user deleted is not an error', () => {
  it('leaves no invalid cable or warning on the tool node, but is still recorded to restore', () => {
    const out = deleteNodesWithUndo(sid, ['t1']);
    expect(g().broken?.[0].reason).toBe('deleted');
    expect(resolveInputs(g(), g().nodes[0], storeEnv())[0]).toMatchObject({ lost: true });
    expect(runProblems(g(), ['op'], storeEnv()).join(' ')).not.toMatch(/invalid/i); // it still stops (the input is empty), without the word «invalid»
    expect(runProblems(g(), ['op'], storeEnv())).toHaveLength(1);
    expect(inspectNode(sid, 'op')?.staleReason ?? '').not.toMatch(/invalid/i);
    expect(restoreNodes(sid, out.deleted!).error).toBeNull(); // and putting the source back reconnects
    expect(g().edges.map((e) => e.id)).toEqual(['e1']);
    expect(g().broken).toBeUndefined();
  });

  it('an incompatible cable is still reported as invalid', () => {
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { ...g(), edges: [], broken: [{ edge: { id: 'e9', source: 't1', target: 'op', sourceHandle: 'out', targetHandle: 'input' }, missing: 'source', reason: 'incompatible', at: 1 }] } } } }));
    expect(runProblems(g(), ['op'], storeEnv())[0]).toMatch(/invalid/);
  });
});
