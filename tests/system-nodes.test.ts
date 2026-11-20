import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * System nodes and link classes (plan "todo es un nodo", steps 8 and 9): chat, agent, models, Designer docs and Spaces
 * are nodes that point to where the data lives; links carry a class (data, ref, control), `both` only on ref and
 * control; the execution order comes from data links, never from position. No provider is called.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { allCommands, collected, command, run } from '../src/engine/commands';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import { connectionError, executionOrder } from '../src/engine/flow/graph';
import { ensureSystemNodes } from '../src/engine/nodes/system';
import { deleteNodes } from '../src/engine/flow/actions';
import { consumersOf } from '../src/engine/nodecore/deps';
import { flowEdges } from '../src/components/node/LinkBar';
import { createSession, setGraph, useStore } from '../src/store/store';
import type { Graph, GraphNode } from '../src/engine/types';

let sid = '';
const on = () => ({ session: sid });
const graph = () => useStore.getState().sessions[sid].graph;
const refs = () => graph().nodes.filter((n) => n.data.kind === 'ref');
const undo = () => travelGraph(sid, graph(), 'undo', 1, (next) => { setGraph(sid, () => next); return true; });

beforeEach(() => {
  const session = createSession('System nodes');
  sid = session.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: session } }));
});

describe('the session\'s parts as nodes', () => {
  it('shows the chat with its agent, the attached models, the Designer doc and the Spaces', () => {
    const doc = useStore.getState().sessions[sid].docs[0];
    ensureSystemNodes(sid);
    const types = refs().map((n) => n.data.kind === 'ref' && n.data.type);
    expect(types).toEqual(expect.arrayContaining(['chat', 'agent', 'model', 'designer.doc', 'space']));
    expect(refs().filter((n) => n.data.kind === 'ref' && n.data.type === 'model').length).toBeGreaterThanOrEqual(2);
    // The doc node points at the doc; nothing is copied into the graph.
    const docNode = refs().find((n) => n.data.kind === 'ref' && n.data.type === 'designer.doc')!;
    expect(docNode.data).toMatchObject({ kind: 'ref', ref: doc?.id ?? 'active' });
    expect(JSON.stringify(graph())).not.toContain('"layers"');
    // Chat and agent are linked by a bidirectional control link; models are control links; the doc is a reference.
    const edge = (a: string, b: string) => graph().edges.find((e) => e.source === a && e.target === b);
    expect(edge('sys_chat', 'sys_agent')).toMatchObject({ kind: 'control', both: true });
    expect(edge('sys_model_llm', 'sys_agent')).toMatchObject({ kind: 'control' });
    expect(graph().edges.find((e) => e.kind === 'ref')).toBeDefined();
  });

  it('is added once, without an undo step, and leaves the rest of the graph alone', () => {
    const own: GraphNode = { id: 'mine', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Prompt', text: 'hola' } };
    setGraph(sid, (g) => ({ ...g, nodes: [own] }));
    const steps = graphHistory(sid, 'undo').length;
    const added = ensureSystemNodes(sid);
    expect(added.length).toBeGreaterThan(3);
    expect(ensureSystemNodes(sid)).toEqual([]);
    expect(graphHistory(sid, 'undo')).toHaveLength(steps);
    expect(graph().nodes.find((n) => n.id === 'mine')).toEqual(own);
  });

  it('keeps a saved graph unchanged: edges without a class are data links', () => {
    const saved: Graph = {
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'A', text: '' } },
        { id: 'b', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'B', text: '' } },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', targetHandle: 'in', sourceHandle: 'out' }],
    };
    expect(executionOrder(saved, ['b'])).toEqual([]);
    expect(saved.edges[0].kind).toBeUndefined();
  });
});

describe('links with a class', () => {
  beforeEach(() => { ensureSystemNodes(sid); });
  const link = (args: Record<string, unknown>) => run({ cmd: 'nodes.system.link', args, on: on() }, { caller: 'agent' });

  it('infers a compatible creative input and rejects the reverse data link', async () => {
    const image = (id: string): GraphNode => ({
      id, position: { x: 0, y: 0 },
      data: { kind: 'image', title: id, prompt: '', modelRef: 'local::image', settings: { count: 1, advanced: {} }, outputIndex: 0 },
    });
    setGraph(sid, g => ({ ...g, nodes: [...g.nodes, image('first'), image('second')] }));
    expect((await link({ source: 'first', target: 'second', kind: 'data' })).ok).toBe(true);
    expect(graph().edges.find(e => e.source === 'first')).toMatchObject({ sourceHandle: 'out', targetHandle: 'ref' });
    expect(consumersOf(graph(), ['first'])).toContain('second');
    const order = await run({ cmd: 'nodes.system.execution_order', args: { targets: ['second'] }, on: on() }, { caller: 'agent' });
    expect(order).toMatchObject({ ok: true, results: [{ order: ['first', 'second'] }] });
    const before = graph();
    expect(await link({ source: 'second', target: 'first', kind: 'data' })).toMatchObject({
      ok: false, error: { message: expect.stringContaining('loop') },
    });
    expect(graph()).toBe(before);
  });

  it('refuses invented handles and incompatible real inputs without adding a cable', async () => {
    const node: GraphNode = { id: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Image', prompt: '', modelRef: '', settings: { count: 1, advanced: {} }, outputIndex: 0 } };
    setGraph(sid, g => ({ ...g, nodes: [...g.nodes, node] }));
    const before = graph();
    for (const target_handle of ['in', 'ref']) {
      expect(await link({ source: 'sys_chat', target: 'image', kind: 'data', target_handle })).toMatchObject({ ok: false });
      expect(graph()).toBe(before);
    }
  });

  it('links with each class, one undo step each, and unlinks with one', async () => {
    const before = graph().edges.length;
    const steps = graphHistory(sid, 'undo').length;
    const ref = await link({ source: 'sys_agent', target: 'sys_space_tools', kind: 'ref', both: true });
    expect(ref.ok).toBe(true);
    expect(graph().edges.find((e) => e.target === 'sys_space_tools')).toMatchObject({ kind: 'ref', both: true });
    expect(graphHistory(sid, 'undo')).toHaveLength(steps + 1);
    const ctl = await link({ source: 'sys_chat', target: 'sys_space_tools', kind: 'control' });
    expect(ctl.ok).toBe(true);
    expect(graph().edges).toHaveLength(before + 2);
    expect(graphHistory(sid, 'undo')).toHaveLength(steps + 2);
    expect(undo()).toBe(true);
    expect(graph().edges).toHaveLength(before + 1);

    const gone = await run({ cmd: 'nodes.system.unlink', args: { source: 'sys_agent', target: 'sys_space_tools', kind: 'ref' }, on: on() }, { caller: 'agent' });
    expect(gone.ok).toBe(true);
    expect(graph().edges).toHaveLength(before);
    expect(undo()).toBe(true);
    expect(graph().edges).toHaveLength(before + 1);
  });

  it('refuses a bidirectional data link and a mismatch of classes', async () => {
    const both = await link({ source: 'sys_agent', target: 'sys_space_tools', kind: 'data', both: true });
    expect(both).toMatchObject({ ok: false });
    const mismatch = await link({ source: 'sys_agent', target: 'sys_space_tools', kind: 'ref', target_handle: 'control' });
    expect(mismatch).toMatchObject({ ok: false });
    expect(graph().edges.some((e) => e.target === 'sys_space_tools')).toBe(false);
  });

  it('the canvas validation uses the ports: ref to ref passes, ref to control does not', () => {
    const g = graph();
    const st = useStore.getState();
    expect(connectionError(g, st.assets, { source: 'sys_agent', target: 'sys_space_tools', sourceHandle: 'target', targetHandle: 'ref' })).toBeNull();
    expect(connectionError(g, st.assets, { source: 'sys_agent', target: 'sys_space_tools', sourceHandle: 'target', targetHandle: 'control' })).not.toBeNull();
  });

  it('attaches a model in each mode and detaches it', async () => {
    for (const mode of ['wired', 'docked', 'grouped', 'merged'] as const) {
      const res = await run({ cmd: 'nodes.system.attach_model', args: { model_ref: 'test::model', mode, media_kind: 'image' }, on: on() }, { caller: 'agent' });
      expect(res.ok, mode).toBe(true);
    }
    const node = refs().find((n) => n.data.kind === 'ref' && n.data.type === 'model' && n.data.ref === 'test::model')!;
    expect(node.data).toMatchObject({ attachMode: 'merged' });
    expect((await run({ cmd: 'nodes.system.detach_model', args: { model_ref: 'test::model' }, on: on() }, { caller: 'agent' })).ok).toBe(true);
    expect(graph().edges.some((e) => e.source === node.id && e.target === 'sys_agent')).toBe(false);
  });
});

describe('execution order', () => {
  it('follows data links, not position or the other classes', () => {
    const t = (id: string, x: number): GraphNode => ({ id, position: { x, y: 0 }, data: { kind: 'image', title: id, prompt: '', modelRef: 'm', settings: {}, outputIndex: 0 } as GraphNode['data'] });
    // `late` sits left of `first` on screen; the order must still be first, late.
    const g: Graph = {
      nodes: [t('late', -500), t('first', 900)],
      edges: [
        { id: 'd', source: 'first', target: 'late', targetHandle: 'ref', sourceHandle: 'out' },
        { id: 'c', source: 'late', target: 'first', targetHandle: 'control', sourceHandle: 'out_control', kind: 'control' },
      ],
    };
    expect(executionOrder(g, ['late'])).toEqual(['first', 'late']);
    expect(executionOrder({ ...g, edges: [g.edges[1]] }, ['late'])).toEqual(['late']);
  });
});

describe('commands', () => {
  it('are found by the automatic index with strict schemas', () => {
    expect(collected.loaded.map((l) => l.file)).toEqual(expect.arrayContaining(['/src/engine/nodes/commands.ts']));
    const ids = allCommands().filter((c) => c.id.startsWith('nodes.system.')).map((c) => c.id).sort();
    expect(ids).toEqual(['nodes.system.add', 'nodes.system.attach_model', 'nodes.system.detach_model', 'nodes.system.ensure', 'nodes.system.ensure_omni', 'nodes.system.execution_order', 'nodes.system.link', 'nodes.system.list', 'nodes.system.set_link', 'nodes.system.set_view', 'nodes.system.unlink']);
    expect(command('nodes.system.link')!.effect).toBe('write');
  });

  it('let the agent list, add and link in one sequence, with one undo step', async () => {
    const steps = graphHistory(sid, 'undo').length;
    const result = await run({
      on: on(),
      seq: [
        { cmd: 'nodes.system.ensure', args: {} },
        { cmd: 'nodes.system.add', args: { type: 'library' } },
        { cmd: 'nodes.system.link', args: { source: '$2.node', target: 'sys_agent', kind: 'ref' } },
      ],
    }, { caller: 'agent' });
    expect(result.ok).toBe(true);
    expect(graph().edges.some((e) => e.source.startsWith('sys_library') && e.kind === 'ref')).toBe(true);
    expect(graphHistory(sid, 'undo').length).toBe(steps + 1);
  });
});

describe('layout, removal and link edits', () => {
  it('lays the system nodes out without overlap and to the left of the user\'s nodes', () => {
    const own: GraphNode = { id: 'mine', position: { x: 100, y: 50 }, data: { kind: 'text', title: 'Prompt', text: '' } };
    setGraph(sid, (g) => ({ ...g, nodes: [own] }));
    ensureSystemNodes(sid);
    const sys = refs();
    for (const n of sys) expect(n.position.x + 260).toBeLessThan(100);
    for (const [i, a] of sys.entries()) for (const b of sys.slice(i + 1)) {
      const apart = Math.abs(a.position.x - b.position.x) >= 520 || Math.abs(a.position.y - b.position.y) >= 300;
      expect(apart, `${a.id} / ${b.id}`).toBe(true);
    }
  });

  it('removing a system node is one undo step that restores the same position and its links', () => {
    ensureSystemNodes(sid);
    const agent = graph().nodes.find((n) => n.id === 'sys_agent')!;
    const edges = graph().edges.length;
    const steps = graphHistory(sid, 'undo').length;
    expect(deleteNodes(sid, ['sys_agent'])).toBeNull();
    expect(graphHistory(sid, 'undo')).toHaveLength(steps + 1);
    expect(undo()).toBe(true);
    expect(graph().nodes.find((n) => n.id === 'sys_agent')!.position).toEqual(agent.position);
    expect(graph().edges).toHaveLength(edges);
  });

  it('toggles both on a ref or control link only, one undo step each, and draws them differently', async () => {
    ensureSystemNodes(sid);
    const ref = graph().edges.find((e) => e.kind === 'ref')!;
    const steps = graphHistory(sid, 'undo').length;
    const off = await run({ cmd: 'nodes.system.set_link', args: { edge: ref.id, both: !ref.both }, on: on() }, { caller: 'agent' });
    expect(off.ok).toBe(true);
    expect(graph().edges.find((e) => e.id === ref.id)!.both).toBe(!ref.both || undefined);
    expect(graphHistory(sid, 'undo')).toHaveLength(steps + 1);
    const data: Graph = { nodes: graph().nodes, edges: [{ id: 'd', source: 'sys_chat', target: 'sys_agent', targetHandle: 'in', sourceHandle: 'out' }] };
    const flow = flowEdges({ ...graph(), edges: [...graph().edges, ...data.edges] }, {}, new Set(), new Set());
    expect(flow.find((e) => e.id === 'd')!.className).not.toContain('edge-link');
    expect(flow.find((e) => e.id === ref.id)!.className).toContain('edge-link-ref');
  });

  it('naming a system node before they exist does not create them', async () => {
    const res = await run({ cmd: 'nodes.system.link', args: { source: 'sys_agent', target: 'sys_chat', kind: 'ref' }, on: on() }, { caller: 'agent' });
    expect(res).toMatchObject({ ok: false });
    expect(refs()).toHaveLength(0);
    expect((await run({ cmd: 'nodes.system.list', args: {}, on: on() }, { caller: 'agent' })).ok).toBe(true);
    expect(refs()).toHaveLength(0);
  });
});
