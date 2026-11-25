import { beforeEach, describe, expect, it, vi } from 'vitest';

const blobs = new Map<string, Blob>();
vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: {
    get: async (k: string) => blobs.get(k),
    set: async (k: string, b: Blob) => { blobs.set(k, b); },
    del: async (k: string) => { blobs.delete(k); },
    delMany: async (ks: string[]) => { for (const k of ks) blobs.delete(k); },
  },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { migrateGraph, stampNew } from '../src/engine/nodecore/migrate';
import { applyEdit, editCompound } from '../src/engine/nodecore/edit';
import { autoLayout, estimatedHeight, graphToSteps, nodeRect } from '../src/engine/flow/graph';
import { libraryToNodes } from '../src/engine/flow/fromLibrary';
import { nodeRequest } from '../src/engine/flow/freshness';
import { graphIndex, readGraph } from '../src/engine/flow/graphView';
import { nodeWorkNotInChat } from '../src/engine/flow/fromNodes';
import { formatLibraryItemIndex } from '../src/engine/libraryGraph';
import { createItem, libraryToDesigner, saveItem } from '../src/engine/libraryVersions';
import { ordinaryGraph, hiddenInOrdinary } from '../src/engine/nodes/omniSpaces';
import { recordGraph, travelGraph } from '../src/engine/flow/history';
import { storeHooks } from '../src/engine/storeBindings';
import { createSession, useStore } from '../src/store/store';
import type { Graph, GraphEdge, GraphNode, GraphNodeData } from '../src/engine/types';

storeHooks.recordGraph = recordGraph;
const travel = (session: string, dir: 'undo' | 'redo') =>
  travelGraph(session, useStore.getState().sessions[session].graph, dir, 1, (graph) => applyEdit({ session, op: { op: 'travel', graph } }).ok);

let sid: string;

beforeEach(() => {
  blobs.clear();
  const s = createSession('GraphLabelTest');
  sid = s.id;
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
});

describe('Library graph guidelines, GraphEdge.label, and unknown legacy node resilience', () => {
  it('opens a saved kit carrying an unknown node kind without crashing across index, Designer, and Nodes', async () => {
    const { subject } = await createItem({
      name: 'LegacyKit', kind: 'brand-kit', space: 'library', by: 'user',
      graph: { nodes: [{ id: 'n_keep', position: { x: 40, y: 40 }, data: { kind: 'text', title: 'Voice', text: 'Warm tone', section: 'Voice' } }], edges: [] },
    });
    const unknown: GraphNode = { id: 'n_unknown', position: { x: 240, y: 40 }, data: { kind: 'legacy_widget', title: 'Old' } as unknown as GraphNodeData };
    const patchedGraph: Graph = {
      nodes: [...subject.graph!.nodes, unknown],
      edges: [{ id: 'e_legacy', source: 'n_unknown', target: 'n_keep', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref' }],
    };
    const snapKey = `libver:${subject.versionId}`;
    const snapJson = JSON.parse(await blobs.get(snapKey)!.text()) as Record<string, unknown>;
    snapJson.graph = patchedGraph;
    const encoded = new TextEncoder().encode(JSON.stringify(snapJson));
    blobs.set(snapKey, new Blob([encoded], { type: 'application/json' }));
    useStore.setState((st) => ({ library: st.library.map((s) => (s.id === subject.id ? { ...s, graph: patchedGraph } : s)) }));

    const item = useStore.getState().library.find((s) => s.id === subject.id)!;
    expect(formatLibraryItemIndex(item, useStore.getState().library, {}).text).toContain('Warm tone');
    expect(Number.isFinite(estimatedHeight(unknown.data))).toBe(true);

    const imported = libraryToNodes(sid, item.id);
    expect(imported.added.map((n) => n.data.title)).toEqual(['Voice']);
    expect(imported.edges).toEqual([]);

    const doc = await libraryToDesigner(sid, item.id);
    expect(doc.layers.some((l) => l.type === 'text' && l.text === 'Warm tone')).toBe(true);
    const resaved = await saveItem({ subjectId: item.id, mode: 'overwrite', space: 'designer', by: 'user', sessionId: sid, docId: doc.id });
    expect(resaved.graph?.nodes.map((n) => n.id)).toEqual(['n_keep']);
  });

  it('supports guideline text nodes with section and GraphEdge.label across migrate, edit, layout, graphToSteps, freshness, ordinaryGraph, graphView, fromNodes, undo/redo, and serialization', () => {
    const voiceNode: GraphNode = {
      id: 'n_voice',
      position: { x: 0, y: 0 },
      data: { kind: 'text', title: 'Voice', text: 'Direct and warm', section: 'Voice' },
    };
    const textNode: GraphNode = {
      id: 'n_text',
      position: { x: 300, y: 0 },
      data: { kind: 'text', title: 'Usage', text: 'Use for CTA buttons', section: 'Guidelines' },
    };
    const labeledEdge: GraphEdge = {
      id: 'e_ref_1',
      source: 'n_voice',
      target: 'n_text',
      sourceHandle: 'out_ref',
      targetHandle: 'sys_ref',
      kind: 'ref',
      label: 'tone note',
    };

    const added = editCompound(sid, 'add-guidelines', (g) => ({
      ...g,
      nodes: [...g.nodes, voiceNode, textNode],
      edges: [...g.edges, labeledEdge],
      groups: [...(g.groups ?? []), { id: 'grp_1', title: 'Brand', nodeIds: ['n_voice', 'n_text'] }],
    }));
    expect(added).toBeNull();

    const g1 = useStore.getState().sessions[sid].graph;
    expect(g1.nodes.find((n) => n.id === 'n_voice')?.data).toMatchObject({ kind: 'text', text: 'Direct and warm', section: 'Voice' });
    expect(g1.edges.find((e) => e.id === 'e_ref_1')?.label).toBe('tone note');

    expect(hiddenInOrdinary(voiceNode)).toBe(false);
    const ord = ordinaryGraph(g1);
    expect(ord.nodes.some((n) => n.id === 'n_voice')).toBe(true);
    expect(ord.edges.some((e) => e.id === 'e_ref_1')).toBe(true);

    const h = estimatedHeight(voiceNode.data);
    expect(Number.isFinite(h) && h > 0).toBe(true);
    expect(nodeRect(voiceNode).height).toBe(h);
    const laid = autoLayout(g1.nodes, g1.edges, { x: 0, y: 0 });
    expect(Number.isFinite(laid.get('n_voice')!.x)).toBe(true);

    const plan = graphToSteps(g1, ['n_voice'], {});
    expect(plan.runIds).toEqual([]);
    expect(plan.errors).toEqual([]);
    const req = nodeRequest(g1, textNode, {});
    expect(req.links).toHaveLength(1);

    expect(migrateGraph(g1).nodes).toHaveLength(2);
    expect(stampNew({ nodes: [], edges: [] }, g1).nodes).toHaveLength(2);

    expect(graphIndex(g1, {}, [])).toContain('Voice');
    expect(readGraph(g1, {}, [], { node_ids: ['n_voice'] })).toContain('Direct and warm');
    expect(nodeWorkNotInChat(sid)).toEqual([]);

    const edited = applyEdit({ session: sid, op: { op: 'set', node: 'n_voice', patch: { text: 'Updated voice' }, strict: true } });
    expect(edited.ok).toBe(true);

    expect(travel(sid, 'undo')).toBe(true);
    expect((useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === 'n_voice')?.data as { text?: string })?.text).toBe('Direct and warm');
    expect(travel(sid, 'undo')).toBe(true);
    expect(useStore.getState().sessions[sid].graph.nodes).toEqual([]);
    expect(travel(sid, 'redo')).toBe(true);
    expect(useStore.getState().sessions[sid].graph.edges.find((e) => e.id === 'e_ref_1')?.label).toBe('tone note');

    const roundTripped = JSON.parse(JSON.stringify(useStore.getState().sessions[sid].graph)) as Graph;
    expect(roundTripped.nodes.find((n) => n.id === 'n_voice')?.data).toMatchObject({ kind: 'text', text: 'Direct and warm', section: 'Voice' });
    expect((roundTripped.edges.find((e) => e.id === 'e_ref_1') as GraphEdge & { label?: string })?.label).toBe('tone note');
  });
});
