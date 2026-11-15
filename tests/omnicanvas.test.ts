import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Omnicanvas engine (plan "todo es un nodo", step 12): one Studio, one Nodes and one Designer node per session, the
 * session's parts and assets as nodes pointing at the data where it lives, the look of each (thumbnail or node) and
 * links of the three classes. The ordinary Nodes canvas keeps drawing what it drew. No provider is called.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { run } from '../src/engine/commands';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import { connectionError } from '../src/engine/flow/graph';
import { tryConnect } from '../src/engine/flow/actions';
import { canvasIndex } from '../src/engine/canvas';
import { addSystemNode, linkSystemNodes, resolveSystemNodeLive, unlinkSystemNodes } from '../src/engine/nodes/system';
import { OMNI_SPACES, addOmniSpace, ensureOmniNodes, omniSpaceNodeId, ordinaryGraph, setChatUndocked, setSpaceParam, setSpaceView } from '../src/engine/nodes/omni';
import { sessionCanvases } from '../src/components/shell/SessionRow';
import { createSession, setGraph, useStore } from '../src/store/store';
import type { Asset, Graph, GraphNode } from '../src/engine/types';

let sid = '';
const on = () => ({ session: sid });
const session = () => useStore.getState().sessions[sid];
const graph = () => session().graph;
const node = (id: string) => graph().nodes.find((n) => n.id === id)!;
const undo = () => travelGraph(sid, graph(), 'undo', 1, (next) => { setGraph(sid, () => next); return true; });
const asset = (id: string, createdAt: number, over: Partial<Asset> = {}): Asset => ({ id, kind: 'image', mime: 'image/png', width: 10, height: 10, sessionId: sid, origin: 'generated', stored: true, favorite: false, createdAt, ...over });
const addAssets = (...list: Asset[]) => useStore.setState((s) => ({ assets: { ...s.assets, ...Object.fromEntries(list.map((a) => [a.id, a])) } }));
const own: GraphNode = { id: 'mine', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Prompt', text: 'hola' } };

beforeEach(() => {
  const created = createSession('Omnicanvas');
  sid = created.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: created }, assets: {} }));
});

describe('what the omnicanvas shows', () => {
  it('has the chat, agent, models and docs, and exactly one Studio, one Nodes and one Designer node', () => {
    ensureOmniNodes(sid);
    const types = graph().nodes.map((n) => n.data.kind === 'ref' && n.data.type);
    expect(types).toEqual(expect.arrayContaining(['chat', 'agent', 'model', 'designer.doc']));
    for (const space of OMNI_SPACES) {
      const spaces = graph().nodes.filter((n) => n.data.kind === 'ref' && n.data.type === 'space' && n.data.ref === space);
      expect(spaces, space).toHaveLength(1);
      expect(spaces[0].id).toBe(omniSpaceNodeId(space));
      expect(spaces[0].data).toMatchObject({ view: 'thumb' });
    }
    // The agent works in every Space: a dotted reference link to each.
    for (const space of OMNI_SPACES) expect(graph().edges.find((e) => e.target === omniSpaceNodeId(space))).toMatchObject({ source: 'sys_agent', kind: 'ref' });
  });

  it('is safe to repeat, adds no undo step and leaves the user\'s nodes alone', () => {
    setGraph(sid, (g) => ({ ...g, nodes: [own] }));
    const steps = graphHistory(sid, 'undo').length;
    expect(ensureOmniNodes(sid).length).toBeGreaterThan(8);
    expect(ensureOmniNodes(sid)).toEqual([]);
    expect(graphHistory(sid, 'undo')).toHaveLength(steps);
    expect(node('mine')).toEqual(own);
  });

  it('asking for a Space again gives the one that is there, and each session has its own', () => {
    const first = addOmniSpace(sid, 'studio');
    expect(first.existed).toBe(false);
    expect(addOmniSpace(sid, 'studio')).toEqual({ id: first.id, existed: true });
    expect(addSystemNode(sid, { type: 'space', ref: 'studio' })).toBe(first.id);
    expect(graph().nodes.filter((n) => n.data.kind === 'ref' && n.data.ref === 'studio')).toHaveLength(1);
    const other = createSession('Other');
    useStore.setState((st) => ({ sessions: { ...st.sessions, [other.id]: other } }));
    expect(addOmniSpace(other.id, 'studio').existed).toBe(false);
  });

  it('brings in the newest assets as nodes that point at them, once, and what the user removed does not return', () => {
    addAssets(...Array.from({ length: 10 }, (_, i) => asset(`a${i}`, 100 + i)), asset('sk', 500, { origin: 'sketch' }), asset('elsewhere', 600, { sessionId: 'other' }));
    ensureOmniNodes(sid);
    const shown = graph().nodes.filter((n) => n.omni);
    expect(shown).toHaveLength(8);
    expect(shown.every((n) => n.data.kind === 'asset')).toBe(true);
    expect(shown.map((n) => n.data.kind === 'asset' && n.data.assetId)).toEqual(['a9', 'a8', 'a7', 'a6', 'a5', 'a4', 'a3', 'a2']);
    expect(JSON.stringify(graph())).not.toContain('image/png');
    // The user removes one; opening again does not bring it back, but a newer asset arrives.
    setGraph(sid, (g) => ({ ...g, nodes: g.nodes.filter((n) => n.id !== 'omni_asset_a9') }));
    addAssets(asset('late', 900));
    ensureOmniNodes(sid);
    const ids = graph().nodes.filter((n) => n.omni).map((n) => n.id);
    expect(ids).not.toContain('omni_asset_a9');
    expect(ids).toContain('omni_asset_late');
    expect(ids.filter((id) => id === 'omni_asset_late')).toHaveLength(1);
  });

  it('does not repeat what a node already shows', () => {
    addAssets(asset('x', 1), asset('y', 2));
    setGraph(sid, (g) => ({ ...g, nodes: [{ id: 'asset-x', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Asset', assetId: 'x' } }] }));
    ensureOmniNodes(sid);
    expect(graph().nodes.filter((n) => n.omni).map((n) => n.id)).toEqual(['omni_asset_y']);
  });
});

describe('the ordinary Nodes canvas', () => {
  it('draws the same graph when the omnicanvas was never opened, and without its nodes after', () => {
    const g: Graph = { nodes: [own], edges: [] };
    expect(ordinaryGraph(g)).toBe(g);
    addAssets(asset('a', 1));
    setGraph(sid, (cur) => ({ ...cur, nodes: [own] }));
    ensureOmniNodes(sid);
    expect(graph().nodes.length).toBeGreaterThan(8);
    const seen = ordinaryGraph(graph());
    expect(seen.nodes).toEqual([own]);
    expect(seen.edges).toEqual([]);
    // A link between a user node and an omnicanvas node stays in the graph but is not drawn there.
    expect(linkSystemNodes(sid, { source: 'mine', target: omniSpaceNodeId('designer'), kind: 'ref' }).error).toBeNull();
    expect(graph().edges.some((e) => e.source === 'mine')).toBe(true);
    expect(ordinaryGraph(graph()).edges).toEqual([]);
  });

  it('does not count what only the omnicanvas shows as the session\'s nodes or canvases', () => {
    addAssets(asset('a', 1));
    ensureOmniNodes(sid);
    expect(sessionCanvases(session())).not.toContain('node');
    const index = canvasIndex(session(), useStore.getState().generations);
    // An upload shown only by the omnicanvas is not an asset of the Nodes canvas.
    addAssets(asset('up', 2, { origin: 'upload' }));
    expect(index.asset(asset('up', 2, { origin: 'upload' }))).toBeUndefined();
  });
});

describe('thumbnail and node look', () => {
  beforeEach(() => { ensureOmniNodes(sid); });

  it('switches a Space node between thumbnail and node without an undo step, and the command does it too', async () => {
    const steps = graphHistory(sid, 'undo').length;
    expect(setSpaceView(sid, omniSpaceNodeId('designer'), 'node')).toBeNull();
    expect(node(omniSpaceNodeId('designer')).data).toMatchObject({ view: 'node' });
    expect(resolveSystemNodeLive(sid, node(omniSpaceNodeId('designer')))).toMatchObject({ view: 'node' });
    const res = await run({ cmd: 'nodes.system.set_view', args: { node: omniSpaceNodeId('designer'), view: 'thumb' }, on: on() }, { caller: 'agent' });
    expect(res.ok).toBe(true);
    expect(node(omniSpaceNodeId('designer')).data).toMatchObject({ view: 'thumb' });
    expect(graphHistory(sid, 'undo')).toHaveLength(steps);
    expect(setSpaceView(sid, 'sys_agent', 'node')).toMatch(/not a Studio/);
    expect(await run({ cmd: 'nodes.system.set_view', args: { node: 'sys_chat' }, on: on() }, { caller: 'agent' })).toMatchObject({ ok: false });
  });

  it('docks and undocks the chat node', () => {
    expect(setChatUndocked(sid, 'sys_chat', true)).toBeNull();
    expect(node('sys_chat').data).toMatchObject({ undocked: true });
    expect(setChatUndocked(sid, 'sys_chat', false)).toBeNull();
    expect('undocked' in node('sys_chat').data).toBe(false);
    expect(setChatUndocked(sid, 'sys_agent', true)).toMatch(/not a chat/);
  });

  it('the chat node undocked knows its agent and models', () => {
    const live = resolveSystemNodeLive(sid, node('sys_chat'))!;
    expect(live.connections?.map((c) => c.kind)).toEqual(expect.arrayContaining(['agent', 'model']));
    expect(live.connections?.find((c) => c.kind === 'agent')).toMatchObject({ nodeId: 'sys_agent' });
  });

  it('each Space node reads its snapshot and parameters where they live', () => {
    const docId = session().docs[0]?.id;
    addAssets(asset('chat1', 10), asset('chat2', 20), asset('design1', 30, { origin: 'design' }));
    const studio = resolveSystemNodeLive(sid, node(omniSpaceNodeId('studio')))!;
    expect(studio.params?.map((p) => p.id)).toEqual(['mode', 'style']);
    const designer = resolveSystemNodeLive(sid, node(omniSpaceNodeId('designer')))!;
    expect(designer.cover).toBe('design1');
    expect(designer.params?.find((p) => p.id === 'doc')).toBeDefined();
    if (docId) expect(designer.docName).toBe(session().docs[0].name);
    const nodes = resolveSystemNodeLive(sid, node(omniSpaceNodeId('nodes')))!;
    expect(nodes.subtitle).toMatch(/^0 nodes/);
    expect(JSON.stringify([studio, designer, nodes])).not.toContain('"layers":[');
  });

  it('the Nodes thumbnail shows the newest picture among the user\'s nodes, else their layout', () => {
    setGraph(sid, (g) => ({ ...g, nodes: [...g.nodes, own, { id: 'p', position: { x: 200, y: 100 }, data: { kind: 'asset', title: 'Asset', assetId: 'pic' } }] }));
    expect(resolveSystemNodeLive(sid, node(omniSpaceNodeId('nodes')))).toMatchObject({ cover: undefined, subtitle: '2 nodes · 0 links' });
    expect(resolveSystemNodeLive(sid, node(omniSpaceNodeId('nodes')))!.map).toHaveLength(2);
    addAssets(asset('pic', 5));
    expect(resolveSystemNodeLive(sid, node(omniSpaceNodeId('nodes')))!.cover).toBe('pic');
  });

  it('edits the parameters the Space itself edits', () => {
    expect(setSpaceParam(sid, 'studio', 'mode', 'video')).toBeNull();
    expect(useStore.getState().composer.mode).toBe('video');
    expect(setSpaceParam(sid, 'studio', 'style', 'guided')).toBeNull();
    expect(useStore.getState().composer.agentStyle).toBe('guided');
    expect(setSpaceParam(sid, 'studio', 'mode', 'nonsense')).toMatch(/no parameter/);
    expect(setSpaceParam(sid, 'nodes', 'nodes', '3')).toMatch(/no parameter/);
  });
});

describe('links of the three classes between the nodes of the omnicanvas', () => {
  beforeEach(() => { ensureOmniNodes(sid); addAssets(asset('pic', 1)); ensureOmniNodes(sid); });
  const studio = omniSpaceNodeId('studio'), designer = omniSpaceNodeId('designer'), nodes = omniSpaceNodeId('nodes');

  it('links data, reference and control, each drawn by its class, and unlinks with an undo step', () => {
    const steps = graphHistory(sid, 'undo').length;
    expect(linkSystemNodes(sid, { source: 'omni_asset_pic', target: designer, kind: 'data' }).error).toBeNull();
    expect(linkSystemNodes(sid, { source: designer, target: studio, kind: 'data' }).error).toBeNull();
    expect(linkSystemNodes(sid, { source: studio, target: nodes, kind: 'ref', both: true }).error).toBeNull();
    expect(linkSystemNodes(sid, { source: studio, target: designer, kind: 'control' }).error).toBeNull();
    const kinds = graph().edges.filter((e) => [studio, designer, nodes].includes(e.target) && e.source !== 'sys_agent').map((e) => `${e.kind ?? 'data'}${e.both ? '+both' : ''}`);
    expect(kinds.sort()).toEqual(['control', 'data', 'data', 'ref+both']);
    expect(graphHistory(sid, 'undo')).toHaveLength(steps + 4);
    const edge = graph().edges.find((e) => e.source === studio && e.target === nodes)!;
    expect(unlinkSystemNodes(sid, { edgeId: edge.id }).removed).toEqual([edge.id]);
    expect(graph().edges.some((e) => e.id === edge.id)).toBe(false);
    expect(undo()).toBe(true);
    expect(graph().edges.some((e) => e.id === edge.id)).toBe(true);
  });

  it('the canvas accepts what the ports allow and refuses the rest', () => {
    const g = graph(), st = useStore.getState();
    expect(connectionError(g, st.assets, { source: 'omni_asset_pic', target: designer, sourceHandle: 'out', targetHandle: 'in' })).toBeNull();
    expect(connectionError(g, st.assets, { source: studio, target: designer, sourceHandle: 'space', targetHandle: 'ref' })).toBeNull();
    expect(connectionError(g, st.assets, { source: studio, target: designer, sourceHandle: 'out_control', targetHandle: 'control' })).toBeNull();
    expect(connectionError(g, st.assets, { source: studio, target: designer, sourceHandle: 'space', targetHandle: 'control' })).toMatch(/class/);
    expect(connectionError(g, st.assets, { source: studio, target: designer, sourceHandle: 'out', targetHandle: 'ref' })).toMatch(/class/);
    expect(connectionError(g, st.assets, { source: designer, target: designer, sourceHandle: 'out', targetHandle: 'in' })).toMatch(/itself/);
    expect(linkSystemNodes(sid, { source: studio, target: designer, kind: 'data', both: true }).error).toMatch(/bidirectional/);
  });

  it('a drag on the canvas links with the class of the port it started from', async () => {
    const res = await tryConnect(sid, { source: studio, target: nodes, sourceHandle: 'space', targetHandle: 'ref' });
    expect(res ?? true).toBeTruthy();
    expect(graph().edges.find((e) => e.source === studio && e.target === nodes)).toMatchObject({ kind: 'ref' });
  });
});
