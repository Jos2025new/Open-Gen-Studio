import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { descriptors, descriptorOf } from '../src/engine/nodecore/registry';
import { resolveInputs, storeEnv } from '../src/engine/nodecore/resolver';
import { consumersOf, findCycle } from '../src/engine/nodecore/deps';
import { applyEdit } from '../src/engine/nodecore/edit';
import { ownerRev } from '../src/engine/nodecore/revision';
import { runProblems } from '../src/engine/nodecore/guard';
import { deleteNodes, patchNodeData, tryConnect } from '../src/engine/flow/actions';
import { linkSystemNodes } from '../src/engine/nodes/system';
import type { Graph, GraphNode, RefNodeData } from '../src/engine/types';

const settings = { count: 1, advanced: {} };
const text = (id: string, t: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'text' as const, title: id, text: t } });
const image = (id: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'image' as const, title: id, prompt: '', modelRef: 'local::image', settings, outputIndex: 0 } });
const graph = (): Graph => ({ nodes: [text('t1', 'hello'), text('t2', 'other'), image('img')], edges: [] });
let sid: string;
const g = () => useStore.getState().sessions[sid].graph;
beforeEach(() => {
  const st = useStore.getState();
  sid = st.activeSessionId;
  useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: graph() } } });
});

describe('node core: descriptors and identity (points 1-2)', () => {
  it('collects one descriptor per node type by itself', () => {
    expect(descriptors().map((d) => d.kind).sort()).toEqual(['asset', 'audio', 'image', 'model3d', 'ref', 'text', 'tool', 'video']);
    expect(descriptorOf('tool')?.required).toEqual(['input']);
  });
  it('keeps a cable to a deleted source visible as invalid, never silently gone', () => {
    expect(tryConnect(sid, { source: 't1', target: 'img', targetHandle: 'prompt' })).toBe(true);
    expect(deleteNodes(sid, ['t1'])).toBeNull();
    const [input] = resolveInputs(g(), g().nodes.find((n) => n.id === 'img')!, storeEnv());
    expect(input).toMatchObject({ port: 'prompt', status: 'invalid', broken: true, from: null });
    // rewiring the port replaces the invalid cable
    tryConnect(sid, { source: 't2', target: 'img', targetHandle: 'prompt' });
    expect(g().broken).toBeUndefined();
  });
  it('a deleted source on a required input blocks the action (the input is empty); on an optional one it does not', () => {
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { nodes: [{ id: 'op', position: { x: 0, y: 0 }, data: { kind: 'tool', title: 'Split', op: 'grid_split', params: { grid: 2 }, outputIndex: 0 } }, text('t1', 'x'), image('img')], edges: [{ id: 'e1', source: 't1', target: 'op', sourceHandle: 'out', targetHandle: 'input' }] } } } }));
    deleteNodes(sid, ['t1']);
    expect(runProblems(g(), ['op'], storeEnv())[0]).toContain('input is empty');
    expect(runProblems(g(), ['img'], storeEnv())).toEqual([]);
  });
});

describe('node core: dependencies and cycles (point 4)', () => {
  it.each<Pick<RefNodeData, 'type' | 'ref'>>([
    { type: 'space', ref: 'designer' },
    { type: 'session', ref: 'studio' },
  ])('refuses a ref patch that reactivates a cycle from $type/$ref', (initial) => {
    const agent: GraphNode = { ...text('agent', ''), data: { kind: 'ref', title: 'Agent', type: 'agent', ref: sid } };
    const space: GraphNode = { ...text('space', ''), data: { kind: 'ref', title: 'Space', ...initial } };
    const before: Graph = { nodes: [agent, space], edges: [
      { id: 'prompt', source: 'agent', sourceHandle: 'out', target: 'space', targetHandle: 'in' },
      { id: 'result', source: 'space', sourceHandle: 'out', target: 'agent', targetHandle: 'in' },
    ] };
    useStore.setState(st => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: before } } }));
    expect(findCycle(before)).toBeNull();
    const patch: Partial<RefNodeData> = initial.type === 'space' ? { ref: 'studio' } : { type: 'space' };
    const result = applyEdit({ session: sid, op: { op: 'set', node: 'space', patch } });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('loop') });
    expect(g()).toBe(before);
  });

  it('rejects a data cycle when editing, with the path', () => {
    const tool = (id: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'tool' as const, title: id, op: 'grid_split' as const, params: {}, outputIndex: 0 } });
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { nodes: [tool('a'), tool('b')], edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'input' }] } } } }));
    const done = applyEdit({ session: sid, op: { op: 'connect', source: 'b', target: 'a', targetHandle: 'input', replaces: null } });
    expect(done.ok).toBe(false);
    expect(!done.ok && done.error).toContain('loop');
    expect(findCycle(g())).toBeNull();
  });
  it('invalidates downstream consumers through data, subject and declarative links', () => {
    const gr: Graph = { nodes: [text('t', 'x'), image('a'), image('b'), image('c')], edges: [
      { id: '1', source: 't', target: 'a', sourceHandle: 'out', targetHandle: 'prompt' },
      { id: '2', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'ref' },
      { id: '3', source: 'b', target: 'c', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref' },
    ] };
    expect(consumersOf(gr, ['t']).sort()).toEqual(['a', 'b', 'c']);
    expect(consumersOf(gr, ['c'])).toEqual([]);
  });
});

describe('node core: one editing layer with preconditions (point 5)', () => {
  it('refuses a stale edit with a conflict and hands the request back as a draft', () => {
    const rev = ownerRev(g(), 't1');
    patchNodeData(sid, 't1', { text: 'changed meanwhile' });
    const done = applyEdit({ session: sid, expect: { t1: rev }, op: { op: 'set', node: 't1', patch: { text: 'my edit' } } });
    expect(done).toMatchObject({ ok: false, conflict: { node: 't1', expected: rev } });
    expect(!done.ok && done.draft.op).toMatchObject({ patch: { text: 'my edit' } });
    expect((g().nodes[0].data as { text: string }).text).toBe('changed meanwhile');
    const fresh = applyEdit({ session: sid, expect: { t1: ownerRev(g(), 't1') }, op: { op: 'set', node: 't1', patch: { text: 'my edit' } } });
    expect(fresh.ok).toBe(true);
  });
  it('replacing a single-cable input names the old cable as its precondition', () => {
    tryConnect(sid, { source: 't1', target: 'img', targetHandle: 'prompt' });
    const old = g().edges[0].id;
    const blind = applyEdit({ session: sid, op: { op: 'connect', source: 't2', target: 'img', targetHandle: 'prompt', replaces: null } });
    expect(blind).toMatchObject({ ok: false, conflict: { actual: old } });
    expect(applyEdit({ session: sid, op: { op: 'connect', source: 't2', target: 'img', targetHandle: 'prompt', replaces: old } }).ok).toBe(true);
    expect(g().edges.map((e) => e.source)).toEqual(['t2']);
  });
  it('the UI path and the system-link path make the same cable through the same layer', () => {
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: graph() } } }));
    const ui = tryConnect(sid, { source: 't1', target: 'img', targetHandle: 'prompt' });
    const linked = linkSystemNodes(sid, { source: 't2', target: 'img', kind: 'data', targetHandle: 'prompt' });
    expect(ui).toBe(true);
    expect(linked.error).toBeNull();
    const onPrompt = g().edges.filter((e) => e.target === 'img' && e.targetHandle === 'prompt');
    expect(onPrompt.map((e) => e.source)).toEqual(['t2']); // single-cable port: the second replaced the first, in both paths
  });
  it('connecting never starts a generation or changes a result', () => {
    const before = JSON.stringify(Object.keys(useStore.getState().generations));
    tryConnect(sid, { source: 't1', target: 'img', targetHandle: 'prompt' });
    expect(JSON.stringify(Object.keys(useStore.getState().generations))).toBe(before);
  });
});
