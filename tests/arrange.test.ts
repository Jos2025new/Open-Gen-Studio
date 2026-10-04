import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));

import { useStore } from '../src/store/store';
import { alignPositions, copyNodes, cutNodes, detachOutputs, detachedOutputGroup, groupNodes, pasteNodes, reattachOutputs, ungroup, wholeGroup } from '../src/engine/flow/arrange';
import { deleteNodes } from '../src/engine/flow/actions';
import { connect, graphToSteps, nodeOutputAsset } from '../src/engine/flow/graph';
import { nodeRequest, stable } from '../src/engine/flow/freshness';
import type { Generation, GenNodeData, Graph } from '../src/engine/types';

const img = (title: string) => ({ kind: 'image', title, prompt: title, modelRef: 'atlas::nb', settings: { count: 1, advanced: {} }, outputIndex: 0 });
const graph = (): Graph => ({
  nodes: [
    { id: 'a', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Asset', assetId: 'up' } },
    { id: 'b', position: { x: 400, y: 50 }, data: { ...img('B'), generationId: 'gB' } as never },
    { id: 'c', position: { x: 1000, y: 200 }, data: img('C') as never },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'ref' }, { id: 'e2', source: 'b', target: 'c', sourceHandle: 'out', targetHandle: 'ref' }],
});
const sizes = new Map([['a', { width: 300, height: 200 }], ['b', { width: 300, height: 300 }], ['c', { width: 300, height: 100 }]]);
const setup = () => {
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({ assets: { ...st.assets, up: { id: 'up', kind: 'image', mime: 'image/png', width: 10, height: 10, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 } }, sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: graph(), feed: [] } } });
  return sid;
};
const g = (sid: string) => useStore.getState().sessions[sid].graph;

describe('arrange several nodes', () => {
  it('aligns edges and centers to the selection or to the first selected, and spaces them evenly', () => {
    const gr = graph();
    expect([...alignPositions(gr, ['a', 'b', 'c'], 'top', 'selection', sizes).values()].map((p) => p.y)).toEqual([0, 0, 0]);
    expect([...alignPositions(gr, ['a', 'b', 'c'], 'bottom', 'selection', sizes).values()].map((p) => p.y)).toEqual([150, 50, 250]); // b's bottom (350) is the lowest
    const toFirst = alignPositions(gr, ['b', 'a', 'c'], 'middle', 'first', sizes);
    expect(toFirst.has('b')).toBe(false); // the first one stays
    expect(toFirst.get('a')!.y).toBe(100); // b's middle is 200: a (200 tall) at 100
    const spread = alignPositions(gr, ['a', 'b', 'c'], 'distribute-h', 'selection', sizes);
    expect(spread.get('b')!.x).toBe(500); // span 0..1300, 900 used: gaps of 200 → a 0–300, b 500–800, c 1000
  });

  it('groups (one group per node), ungroups, and deleting a node takes it out of its group', () => {
    const sid = setup();
    const id = groupNodes(sid, ['a', 'b'])!;
    expect(wholeGroup(g(sid), ['b', 'a'])?.id).toBe(id);
    groupNodes(sid, ['b', 'c']);
    expect(g(sid).groups!.map((x) => x.nodeIds)).toEqual([['b', 'c']]); // a group of one is dropped
    deleteNodes(sid, ['c']);
    expect(g(sid).groups).toEqual([]);
    const again = groupNodes(sid, ['a', 'b'])!;
    ungroup(sid, again);
    expect(g(sid).groups).toEqual([]);
  });

  it('copy/paste keeps params and links (inside and from outside) without results; cut removes the originals', () => {
    const sid = setup();
    copyNodes(sid, ['b', 'c']);
    const ids = pasteNodes(sid);
    const added = g(sid).nodes.filter((n) => ids.includes(n.id));
    expect(added.map((n) => n.data.title)).toEqual(['B', 'C']);
    expect('generationId' in added[0].data && added[0].data.generationId).toBeFalsy();
    const links = g(sid).edges.filter((e) => ids.includes(e.target)).map((e) => [e.source === 'a' ? 'a' : ids.indexOf(e.source), ids.indexOf(e.target)]);
    expect(links).toEqual([['a', 0], [0, 1]]);
    cutNodes(sid, ['c']);
    expect(g(sid).nodes.some((n) => n.id === 'c')).toBe(false);
    expect(pasteNodes(sid)).toHaveLength(1);
  });
});

const setupOutputs = (groups?: Graph['groups']) => {
  const sid = setup(), state = useStore.getState();
  const gr = graph();
  const source = gr.nodes[1];
  (source.data as GenNodeData).settings = { count: 3, seed: 73, negative: 'keep', advanced: { custom: true } };
  (source.data as GenNodeData).outputIndex = 1;
  if (groups !== undefined) gr.groups = groups;
  gr.viewport = { x: 12, y: 30, zoom: .7 };
  const generation = { id: 'gB', sessionId: sid, stepId: 'b', status: 'done', kind: 'image', prompt: 'B', modelRef: 'atlas::nb', settings: structuredClone((source.data as GenNodeData).settings), inputs: { refs: ['up'] }, assetIds: ['first', 'chosen', 'last'] } as Generation;
  generation.nodeRequest = stable(nodeRequest(gr, source, { gB: generation }));
  const assets = { ...state.assets };
  for (const id of generation.assetIds) assets[id] = { ...state.assets.up, id, generationId: 'gB' };
  useStore.setState({ assets, generations: { gB: generation }, sessions: { ...state.sessions, [sid]: { ...state.sessions[sid], graph: gr } } });
  return sid;
};

describe('detach and reattach existing node outputs', () => {
  it.each([undefined, [], [{ id: 'prior', title: 'Prior', color: '#123456', nodeIds: ['a', 'b'] }], [{ id: 'prior', title: 'Prior', nodeIds: ['a', 'b', 'c'] }]])('restores the exact graph, groups, results and settings (%j)', groups => {
    const sid = setupOutputs(groups), before = structuredClone(g(sid));
    const results = structuredClone(useStore.getState().generations), assets = structuredClone(useStore.getState().assets);
    const ids = detachOutputs(sid, 'b'), detached = g(sid);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe('b');
    const cards = ids.map(id => detached.nodes.find(n => n.id === id)!);
    expect(cards.map(n => nodeOutputAsset(n, useStore.getState().generations))).toEqual(['first', 'chosen', 'last']);
    for (const [index, card] of cards.entries()) {
      expect(card.data).toEqual({ ...before.nodes[1].data, outputIndex: index });
      expect(detached.edges.filter(e => e.target === card.id).map(e => [e.source, e.targetHandle, e.sourceHandle])).toEqual([['a', 'ref', 'out']]);
      expect(detached.edges.filter(e => e.source === card.id)).toHaveLength(index === 1 ? 1 : 0);
    }
    expect(detachOutputs(sid, 'b')).toEqual([]);
    // Reloading JSON preserves the snapshot; restoration does not rely on a module-local map.
    useStore.setState(st => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: JSON.parse(JSON.stringify(detached)) } } }));
    reattachOutputs(sid, detachedOutputGroup(g(sid), 'b')!.id);
    expect(g(sid)).toEqual(before);
    expect(useStore.getState().generations).toEqual(results);
    expect(useStore.getState().assets).toEqual(assets);
  });

  it.each([0, 1, 2])('keeps the downstream request and selected result identical after detaching index %i', index => {
    const sid = setupOutputs();
    useStore.setState(st => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { ...g(sid), nodes: g(sid).nodes.map(n => n.id === 'b' ? { ...n, data: { ...n.data, outputIndex: index } as GenNodeData } : n) } } } }));
    const state = useStore.getState(), before = structuredClone(g(sid));
    const plan = graphToSteps(before, ['c'], state.generations, { assets: state.assets });
    expect(plan.errors).toEqual([]);
    expect(plan.runIds).toEqual(['c']);
    expect(plan.steps[0]).toMatchObject({ refs: [`asset:${['first', 'chosen', 'last'][index]}`] });
    const request = nodeRequest(before, before.nodes[2], state.generations);
    detachOutputs(sid, 'b');
    expect(graphToSteps(g(sid), ['c'], state.generations, { assets: state.assets })).toEqual(plan);
    expect(nodeRequest(g(sid), g(sid).nodes.find(n => n.id === 'c')!, state.generations)).toEqual(request);
  });

  it('keeps new incoming and outgoing connections on reattachment without replacing originals', () => {
    const sid = setupOutputs(), ids = detachOutputs(sid, 'b');
    useStore.setState(st => {
      const gr = st.sessions[sid].graph;
      const next: Graph = { ...gr, nodes: [...gr.nodes, { id: 'extra', position: { x: 1, y: 1 }, data: { kind: 'asset', title: 'Extra', assetId: 'up' } }, { id: 'new-target', position: { x: 2, y: 2 }, data: img('New target') as GenNodeData }] };
      const wired = connect(connect(connect(next, { source: 'extra', target: ids[0], targetHandle: 'ref' }), { source: ids[2], target: 'c', targetHandle: 'ref' }), { source: ids[2], target: 'new-target', targetHandle: 'ref' });
      return { sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: wired } } };
    });
    const additions = g(sid).edges.filter(e => e.source === 'extra' || e.source === ids[2]);
    const group = detachedOutputGroup(g(sid), 'b')!;
    reattachOutputs(sid, group.id);
    expect(g(sid).edges).toContainEqual({ ...additions[0], target: 'b' });
    expect(g(sid).edges).toContainEqual({ ...additions.find(e => e.target === 'new-target')!, source: 'b' });
    // Same source/target/port as the restored original: collapse the redundant edge.
    expect(g(sid).edges.filter(e => e.source === 'b' && e.target === 'c')).toHaveLength(1);
    expect(g(sid).edges.filter(e => e.source === 'a' && e.target === 'b')).toHaveLength(1);
  });

  it('warns and discards new connections that collide on a single-input port or create a cycle', () => {
    const sid = setupOutputs(), ids = detachOutputs(sid, 'b');
    useStore.setState(st => {
      const gr = st.sessions[sid].graph;
      const next: Graph = { ...gr, nodes: [...gr.nodes,
        { id: 'prompt', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Prompt', text: 'original' } },
        { id: 'new-prompt', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'New', text: 'new' } },
      ] };
      const edges = [
        { id: 'p1', source: 'prompt', target: ids[0], sourceHandle: 'out', targetHandle: 'prompt' },
        { id: 'p2', source: 'new-prompt', target: ids[2], sourceHandle: 'out', targetHandle: 'prompt' },
        { id: 'cycle', source: 'c', target: ids[0], sourceHandle: 'out', targetHandle: 'ref' },
      ];
      return { sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { ...next, edges: [...next.edges, ...edges] } } } };
    });
    reattachOutputs(sid, detachedOutputGroup(g(sid), 'b')!.id);
    expect(g(sid).edges.find(e => e.id === 'p1')).toMatchObject({ source: 'prompt', target: 'b' });
    expect(g(sid).edges.some(e => e.id === 'p2' || e.id === 'cycle')).toBe(false);
    expect(useStore.getState().ui.toasts.at(-1)?.text).toContain('Could not keep 2 new connection(s)');
    expect(useStore.getState().ui.toasts.at(-1)?.text).toContain('input port already connected');
    expect(useStore.getState().ui.toasts.at(-1)?.text).toContain('loop');
  });

  it('keeps the output set together and uses ordinary ungroup to reattach it', () => {
    const sid = setupOutputs(), before = structuredClone(g(sid)), ids = detachOutputs(sid, 'b');
    expect(groupNodes(sid, [ids[0], 'a'])).toBeNull();
    ungroup(sid, detachedOutputGroup(g(sid), 'b')!.id);
    expect(g(sid)).toEqual(before);
  });

  it('restores the saved original input instead of replacing it with a new single-port connection', () => {
    const sid = setupOutputs();
    useStore.setState(st => {
      const gr = st.sessions[sid].graph;
      const nodes: Graph['nodes'] = [...gr.nodes,
        { id: 'old-prompt', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Old', text: 'old' } },
        { id: 'replacement', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'New', text: 'new' } },
      ];
      const next = connect({ ...gr, nodes }, { source: 'old-prompt', target: 'b', targetHandle: 'prompt' });
      return { sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: next } } };
    });
    const before = structuredClone(g(sid)), ids = detachOutputs(sid, 'b');
    useStore.setState(st => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: connect(g(sid), { source: 'replacement', target: ids[0], targetHandle: 'prompt' }) } } }));
    reattachOutputs(sid, detachedOutputGroup(g(sid), 'b')!.id);
    expect(g(sid)).toEqual(before);
    expect(useStore.getState().ui.toasts.at(-1)?.text).toContain('input port already connected');
  });

  it('can reattach from the last remaining card after the others are deleted', () => {
    const sid = setupOutputs(), before = structuredClone(g(sid)), ids = detachOutputs(sid, 'b');
    deleteNodes(sid, [ids[0], ids[1]]);
    const group = detachedOutputGroup(g(sid), ids[2])!;
    expect(group.nodeIds).toEqual([ids[2]]);
    ungroup(sid, group.id);
    expect(g(sid)).toEqual(before);
  });

});
