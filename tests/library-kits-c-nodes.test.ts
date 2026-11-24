import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  return {
    blobs,
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> { blobs.set(key, value); },
      async del(key: string): Promise<void> { blobs.delete(key); },
      async delMany(keys: string[]): Promise<void> { for (const k of keys) blobs.delete(k); },
    },
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: hoisted.blobDb,
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { libraryToNodes, nodesToLibrary } from '../src/engine/flow/fromLibrary';
import { applyEdit, editCompound } from '../src/engine/nodecore/edit';
import { recordGraph, travelGraph } from '../src/engine/flow/history';
import { storeHooks } from '../src/engine/storeBindings';
import { run, setApprover } from '../src/engine/commands';
import { createSession, useStore } from '../src/store/store';
import type { Asset, GraphEdge, GraphNode, Subject } from '../src/engine/types';

storeHooks.recordGraph = recordGraph;
const travel = (session: string, dir: 'undo' | 'redo') =>
  travelGraph(session, useStore.getState().sessions[session].graph, dir, 1, (graph) => applyEdit({ session, op: { op: 'travel', graph } }).ok);

function mkAsset(id: string, sessionId: string): Asset {
  return { id, sessionId, kind: 'image', mime: 'image/png', width: 64, height: 64, origin: 'upload', stored: true, favorite: false, createdAt: 1 };
}

beforeEach(() => {
  hoisted.blobs.clear();
  setApprover(() => true);
  const s = createSession('NodesSession');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
});

describe('Part 4: libraryToNodes, nodesToLibrary (overwrite|copy|new), and full Nodes -> Library -> Designer -> save -> Nodes round-trip', () => {
  it('saves group or selection with overwrite|copy|new and imports with new IDs, 1 undo step, named group, no dedup, no execution', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('provider called'); });
    try {
      const sid = useStore.getState().activeSessionId;
      useStore.setState({ assets: { a_ref: mkAsset('a_ref', sid) } });

      const n1: GraphNode = { id: 'orig_img', position: { x: 40, y: 50 }, data: { kind: 'asset', title: 'Hero Ref', assetId: 'a_ref' } };
      const n2: GraphNode = { id: 'orig_txt', position: { x: 340, y: 50 }, data: { kind: 'text', title: 'Mood Copy', text: 'Warm sunlit studio' } };
      const n3: GraphNode = { id: 'orig_col', position: { x: 340, y: 240 }, data: { kind: 'part', partKind: 'color', title: 'Amber', color: '#ff9900' } };
      const e1: GraphEdge = { id: 'orig_e1', source: 'orig_img', target: 'orig_txt', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref', label: 'lighting' };
      const e2: GraphEdge = { id: 'orig_e2', source: 'orig_col', target: 'orig_txt', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref', label: 'palette' };

      expect(editCompound(sid, 'seed', (g) => ({
        ...g,
        nodes: [n1, n2, n3],
        edges: [e1, e2],
        groups: [{ id: 'grp_mood', title: 'Sunlit Board', nodeIds: ['orig_img', 'orig_txt', 'orig_col'] }],
      }))).toBeNull();

      // 1) Save group as NEW Library item
      const created = await nodesToLibrary({ sessionId: sid, mode: 'new', kind: 'moodboard', groupId: 'grp_mood', name: 'Sunlit Board', by: 'user' });
      expect(created.origin?.space).toBe('nodes');
      expect(created.graph?.nodes).toHaveLength(3);
      expect(created.graph?.edges.map((e) => e.label).sort()).toEqual(['lighting', 'palette']);

      // 2) Import into Nodes twice -> NO deduplication, new IDs, named groups, 1 undo step each, zero execution
      const imp1 = libraryToNodes(sid, created.id);
      expect(imp1.added).toHaveLength(3);
      expect(imp1.edges).toHaveLength(2);
      expect(imp1.groupId).toBeTruthy();
      expect(imp1.added.every((n) => !['orig_img', 'orig_txt', 'orig_col'].includes(n.id))).toBe(true);
      expect(useStore.getState().sessions[sid].graph.groups?.some((g) => g.id === imp1.groupId && g.title === 'Sunlit Board')).toBe(true);

      const imp2 = libraryToNodes(sid, created.id);
      expect(imp2.groupId).not.toBe(imp1.groupId);
      expect(imp2.added.every((n) => !imp1.added.some((m) => m.id === n.id))).toBe(true);
      expect(useStore.getState().sessions[sid].graph.nodes).toHaveLength(9);

      // Single undo removes entire imp2 (all 3 nodes, 2 edges, 1 group)
      expect(travel(sid, 'undo')).toBe(true);
      expect(useStore.getState().sessions[sid].graph.nodes).toHaveLength(6);
      expect(useStore.getState().sessions[sid].graph.groups?.some((g) => g.id === imp2.groupId)).toBe(false);

      // 3) Save selection (nodeIds) with OVERWRITE and COPY
      const overwritten = await nodesToLibrary({ sessionId: sid, mode: 'overwrite', subjectId: created.id, nodeIds: ['orig_img', 'orig_txt'], by: 'user', label: '2-node selection' });
      expect(overwritten.graph?.nodes).toHaveLength(2);
      expect(overwritten.versions?.length).toBe(2);

      const copy = await nodesToLibrary({ sessionId: sid, mode: 'copy', subjectId: created.id, groupId: 'grp_mood', name: 'Sunlit Copy', by: 'user' });
      expect(copy.copiedFrom).toBe(created.id);
      expect(copy.origin?.space).toBe('nodes');
      expect(copy.graph?.nodes).toHaveLength(3);
      expect(Object.keys(useStore.getState().generations)).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('round-trips Nodes -> Library -> Designer -> save -> Nodes (serialized & reloaded) with identical nodes, edges, labels, and texts', async () => {
    const s1 = useStore.getState().activeSessionId;
    useStore.setState({ assets: { a_logo: mkAsset('a_logo', s1) } });

    expect(editCompound(s1, 'seed-rt', (g) => ({
      ...g,
      nodes: [
        { id: 'rt_a', position: { x: 10, y: 20 }, data: { kind: 'asset', title: 'Logo', assetId: 'a_logo' } },
        { id: 'rt_t', position: { x: 310, y: 20 }, data: { kind: 'text', title: 'Tagline', text: 'Built to last' } },
        { id: 'rt_c', position: { x: 310, y: 210 }, data: { kind: 'part', partKind: 'color', title: 'Cobalt', color: '#1144ff' } },
      ],
      edges: [
        { id: 'rt_e1', source: 'rt_a', target: 'rt_t', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref', label: 'brand voice' },
        { id: 'rt_e2', source: 'rt_c', target: 'rt_a', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref', label: 'primary swatch' },
      ],
      groups: [{ id: 'rt_grp', title: 'Cobalt Kit', nodeIds: ['rt_a', 'rt_t', 'rt_c'] }],
    }))).toBeNull();

    // 1) Nodes -> Library via library.item.save (mode: 'new', space: 'nodes')
    const savedFromNodes = await run({
      cmd: 'library.item.save',
      on: { session: s1 },
      args: { mode: 'new', kind: 'brand-kit', space: 'nodes', groupId: 'rt_grp', name: 'Cobalt Kit' },
    }, { caller: 'agent' });
    expect(savedFromNodes.ok, JSON.stringify(savedFromNodes)).toBe(true);
    const item = savedFromNodes.results[0] as { id: string; versionId?: string };
    expect(useStore.getState().library.find((x) => x.id === item.id)?.origin?.space).toBe('nodes');

    // Serialize & reload #1
    const r1 = JSON.parse(JSON.stringify({ library: useStore.getState().library, sessions: useStore.getState().sessions, assets: useStore.getState().assets })) as { library: Subject[]; sessions: ReturnType<typeof useStore.getState>['sessions']; assets: Record<string, Asset> };
    useStore.setState({ library: r1.library, sessions: r1.sessions, assets: r1.assets });

    // 2) Library -> Designer -> edit Designer doc -> save
    const openDes = await run({ cmd: 'library.item.open', on: { session: s1 }, args: { id: item.id, space: 'designer' } }, { caller: 'agent' });
    expect(openDes.ok, JSON.stringify(openDes)).toBe(true);
    const docId = (openDes.results[0] as { doc: string }).doc;
    const editDes = await run({
      on: { session: s1, doc: docId },
      seq: [
        { cmd: 'designer.layer.add_text', args: { text: 'Designer Header', x: 20, y: 20, width: 200 } },
        { cmd: 'library.item.save', args: { id: item.id, mode: 'overwrite', space: 'designer', doc: docId, label: 'designer-v2' } },
      ],
    }, { caller: 'agent' });
    expect(editDes.ok, JSON.stringify(editDes)).toBe(true);

    // Serialize & reload #2 into a clean session S2
    const s2 = createSession('FreshNodesSession');
    const r2 = JSON.parse(JSON.stringify({ library: useStore.getState().library, assets: useStore.getState().assets })) as { library: Subject[]; assets: Record<string, Asset> };
    useStore.setState({ sessions: { [s2.id]: s2 }, activeSessionId: s2.id, library: r2.library, assets: r2.assets });

    // 3) Library -> Nodes again via library.item.open (space: 'nodes')
    const openNodes = await run({ cmd: 'library.item.open', on: { session: s2.id }, args: { id: item.id, space: 'nodes' } }, { caller: 'agent' });
    expect(openNodes.ok, JSON.stringify(openNodes)).toBe(true);
    const g2 = useStore.getState().sessions[s2.id].graph;
    expect(g2.nodes).toHaveLength(3);
    expect(g2.edges).toHaveLength(2);
    expect(g2.groups).toHaveLength(1);
    expect(g2.groups![0].title).toBe('Cobalt Kit');

    // Verify exact nodes, texts, colors, assetIds, and edge labels survived intact!
    const byTitle = new Map(g2.nodes.map((n) => [n.data.title, n]));
    expect(byTitle.get('Logo')?.data).toMatchObject({ kind: 'asset', assetId: 'a_logo' });
    expect(byTitle.get('Tagline')?.data).toMatchObject({ kind: 'text', text: 'Built to last' });
    expect(byTitle.get('Cobalt')?.data).toMatchObject({ kind: 'part', partKind: 'color', color: '#1144ff' });

    const edgeSummary = g2.edges.map((e) => {
      const src = g2.nodes.find((n) => n.id === e.source)!.data.title;
      const tgt = g2.nodes.find((n) => n.id === e.target)!.data.title;
      return `${src}->${tgt}:${e.label}:${e.kind}`;
    }).sort();
    expect(edgeSummary).toEqual([
      'Cobalt->Logo:primary swatch:ref',
      'Logo->Tagline:brand voice:ref',
    ]);
  });
});
