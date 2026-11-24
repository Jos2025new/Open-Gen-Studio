import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { descriptorOf } from '../src/engine/nodecore/registry';
import { migrateGraph, stampNew } from '../src/engine/nodecore/migrate';
import { applyEdit, editCompound } from '../src/engine/nodecore/edit';
import { autoLayout, estimatedHeight, graphToSteps, nodeRect } from '../src/engine/flow/graph';
import { nodeRequest } from '../src/engine/flow/freshness';
import { graphIndex, readGraph } from '../src/engine/flow/graphView';
import { nodeWorkNotInChat } from '../src/engine/flow/fromNodes';
import { ordinaryGraph, hiddenInOrdinary } from '../src/engine/nodes/omniSpaces';
import { recordGraph, travelGraph } from '../src/engine/flow/history';
import { storeHooks } from '../src/engine/storeBindings';
import { createSession, useStore } from '../src/store/store';
import type { Graph, GraphEdge, GraphNode } from '../src/engine/types';

storeHooks.recordGraph = recordGraph;
const travel = (session: string, dir: 'undo' | 'redo') =>
  travelGraph(session, useStore.getState().sessions[session].graph, dir, 1, (graph) => applyEdit({ session, op: { op: 'travel', graph } }).ok);

let sid: string;

beforeEach(() => {
  const s = createSession('PartNodeTest');
  sid = s.id;
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
});

describe('Part 1: part node descriptor, GraphEdge.label, and graph system compatibility', () => {
  it('registers part node via open descriptor registry without execution', () => {
    const desc = descriptorOf('part');
    expect(desc).toBeDefined();
    expect(desc?.kind).toBe('part');
    expect(desc?.version).toBe(1);
    expect(desc?.plan).toBeUndefined();
    expect(desc?.inputs({ kind: 'part', partKind: 'color', title: 'Accent', color: '#ff5500' })).toEqual([]);
    expect(desc?.output({ kind: 'part', partKind: 'color', title: 'Accent', color: '#ff5500' }, {})).toBeNull();
  });

  it('supports part nodes and GraphEdge.label across migrate, edit, layout, graphToSteps, freshness, ordinaryGraph, graphView, fromNodes, undo/redo, and serialization', () => {
    const colorNode: GraphNode = {
      id: 'n_color',
      position: { x: 0, y: 0 },
      data: { kind: 'part', partKind: 'color', title: 'Primary', color: '#2255ff' },
    };
    const textNode: GraphNode = {
      id: 'n_text',
      position: { x: 300, y: 0 },
      data: { kind: 'text', title: 'Usage', text: 'Use for CTA buttons' },
    };
    const labeledEdge: GraphEdge = {
      id: 'e_ref_1',
      source: 'n_color',
      target: 'n_text',
      sourceHandle: 'out_ref',
      targetHandle: 'sys_ref',
      kind: 'ref',
      label: 'color note',
    };

    // 1) editCompound adds part node + labeled ref edge in 1 undo step
    const added = editCompound(sid, 'add-part', (g) => ({
      ...g,
      nodes: [...g.nodes, colorNode, textNode],
      edges: [...g.edges, labeledEdge],
      groups: [...(g.groups ?? []), { id: 'grp_1', title: 'Brand', nodeIds: ['n_color', 'n_text'] }],
    }));
    expect(added).toBeNull();

    const g1 = useStore.getState().sessions[sid].graph;
    expect(g1.nodes.find((n) => n.id === 'n_color')?.data).toMatchObject({ kind: 'part', partKind: 'color', color: '#2255ff' });
    expect(g1.edges.find((e) => e.id === 'e_ref_1')?.label).toBe('color note');

    // 2) ordinaryGraph does NOT hide part nodes or their ref edges
    expect(hiddenInOrdinary(colorNode)).toBe(false);
    const ord = ordinaryGraph(g1);
    expect(ord.nodes.some((n) => n.id === 'n_color')).toBe(true);
    expect(ord.edges.some((e) => e.id === 'e_ref_1')).toBe(true);

    // 3) layout / estimatedHeight / nodeRect return finite dimensions
    const h = estimatedHeight(colorNode.data);
    expect(Number.isFinite(h) && h > 0).toBe(true);
    expect(nodeRect(colorNode).height).toBe(h);
    const laid = autoLayout(g1.nodes, g1.edges, { x: 0, y: 0 });
    expect(Number.isFinite(laid.get('n_color')!.x)).toBe(true);

    // 4) graphToSteps never executes part nodes; freshness handles ref edge from part
    const plan = graphToSteps(g1, ['n_color'], {});
    expect(plan.runIds).toEqual([]);
    expect(plan.errors).toEqual([]);
    const req = nodeRequest(g1, textNode, {});
    expect(req.links).toHaveLength(1);

    // 5) migrateGraph & stampNew pass cleanly
    expect(migrateGraph(g1).nodes).toHaveLength(2);
    expect(stampNew({ nodes: [], edges: [] }, g1).nodes).toHaveLength(2);

    // 6) graphView & fromNodes handle part cleanly
    expect(graphIndex(g1, {}, [])).toContain('part');
    expect(readGraph(g1, {}, [], { node_ids: ['n_color'] })).toContain('Primary');
    expect(nodeWorkNotInChat(sid)).toEqual([]);

    // 7) applyEdit strict set works on part params
    const edited = applyEdit({ session: sid, op: { op: 'set', node: 'n_color', patch: { color: '#ff0055' } as never, strict: true } });
    expect(edited.ok).toBe(true);

    // 8) Undo / redo preserves part and edge label
    expect(travel(sid, 'undo')).toBe(true);
    expect((useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === 'n_color')?.data as { color?: string })?.color).toBe('#2255ff');
    expect(travel(sid, 'undo')).toBe(true);
    expect(useStore.getState().sessions[sid].graph.nodes).toEqual([]);
    expect(travel(sid, 'redo')).toBe(true);
    expect(useStore.getState().sessions[sid].graph.edges.find((e) => e.id === 'e_ref_1')?.label).toBe('color note');

    // 9) Serialization round-trip preserves part and edge label
    const roundTripped = JSON.parse(JSON.stringify(useStore.getState().sessions[sid].graph)) as Graph;
    expect(roundTripped.nodes.find((n) => n.id === 'n_color')?.data).toMatchObject({ kind: 'part', partKind: 'color', color: '#2255ff' });
    expect((roundTripped.edges.find((e) => e.id === 'e_ref_1') as GraphEdge & { label?: string })?.label).toBe('color note');
  });
});
