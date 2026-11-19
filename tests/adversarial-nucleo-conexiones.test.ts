import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset, Graph } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));

import { createSession, setGraph, useStore } from '../src/store/store';
import { command, invoke } from '../src/engine/commands';
import { deleteNodes, disconnectEdges, tryConnect } from '../src/engine/flow/actions';
import { travelGraph } from '../src/engine/flow/history';
import { inspectNode } from '../src/engine/nodecore/inspect';

let sid: string;
const text = (id: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'text' as const, title: id, text: id } });
const asset = (id: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'asset' as const, title: id, assetId: id } });
const image = (id: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'image' as const, title: id, prompt: '', modelRef: 'local::image', settings: { count: 1, advanced: {} }, outputIndex: 0 } });
const edge = (id: string, source: string, target: string, targetHandle: string, kind?: 'ref' | 'control') => ({ id, source, target, sourceHandle: 'out', targetHandle, ...(kind ? { kind } : {}) });
const graph = () => useStore.getState().sessions[sid].graph;
const broken = () => (graph().broken ?? []).map((b) => b.edge.id).sort();
const travel = (direction: 'undo' | 'redo') => travelGraph(sid, graph(), direction, 1, (next) => { setGraph(sid, () => next); return true; });
const install = (g: Graph) => useStore.setState((s) => ({ activeSessionId: sid, sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], graph: g } } }));
beforeEach(() => {
  const session = createSession('Connection lifecycle');
  sid = session.id;
  const assets = Object.fromEntries(['a', 'b'].map((id) => [id, { id, kind: 'image', name: id } as Asset]));
  useStore.setState({ activeSessionId: sid, sessions: { [sid]: session }, assets });
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected network request'); });
});

describe('adversarial connection lifecycle', () => {
  it('keeps every lost source on multiple ports until its own consumer is deleted', () => {
    install({ nodes: [asset('a'), asset('b'), text('t'), image('x'), image('y')], edges: [edge('a-x', 'a', 'x', 'ref'), edge('b-x', 'b', 'x', 'ref'), edge('t-x', 't', 'x', 'prompt'), edge('a-y', 'a', 'y', 'ref')] });
    expect(deleteNodes(sid, ['a'])).toBeNull();
    expect(deleteNodes(sid, ['t'])).toBeNull();
    expect(broken()).toEqual(['a-x', 'a-y', 't-x']);
    expect(inspectNode(sid, 'x')!.inputs.filter((i) => i.broken).map((i) => i.edgeId).sort()).toEqual(['a-x', 't-x']);
    expect(deleteNodes(sid, ['x'])).toBeNull();
    expect(broken()).toEqual(['a-y']);
    expect(graph().edges).toEqual([]);
  });

  it('retains data, ref and control identities through deletion undo and redo', () => {
    install({ nodes: [text('t'), image('x')], edges: [edge('d', 't', 'x', 'prompt'), edge('r', 't', 'x', 'sys_ref', 'ref'), edge('c', 't', 'x', 'control', 'control')] });
    expect(deleteNodes(sid, ['t'])).toBeNull();
    expect(broken()).toEqual(['c', 'd', 'r']);
    expect(travel('undo')).toBe(true);
    expect(graph().edges.map((e) => e.id).sort()).toEqual(['c', 'd', 'r']);
    expect(broken()).toEqual([]);
    expect(travel('redo')).toBe(true);
    expect(broken()).toEqual(['c', 'd', 'r']);
  });

  it('undoes and redoes explicit removal of a broken cable without changing surviving cables', () => {
    install({ nodes: [asset('a'), asset('b'), image('x')], edges: [edge('lost', 'a', 'x', 'ref'), edge('live', 'b', 'x', 'ref')] });
    expect(deleteNodes(sid, ['a'])).toBeNull();
    expect(disconnectEdges(sid, ['lost'])).toBeNull();
    expect(broken()).toEqual([]);
    // FALLO REAL: history.ts logical() omits broken, so removing only a broken cable creates no undo step.
    expect(travel('undo')).toBe(true);
    expect.soft(broken()).toEqual(['lost']);
    expect.soft(graph().nodes.some((node) => node.id === 'a')).toBe(false);
    expect(graph().edges.map((e) => e.id)).toEqual(['live']);
    expect(travel('redo')).toBe(true);
    expect(broken()).toEqual([]);
    expect(graph().edges.map((e) => e.id)).toEqual(['live']);
  });

  it('restores a deleted source and its original multiple connections without disturbing another source', () => {
    install({ nodes: [asset('a'), asset('b'), image('x'), image('y')], edges: [edge('a-x', 'a', 'x', 'ref'), edge('a-y', 'a', 'y', 'ref'), edge('b-x', 'b', 'x', 'ref')] });
    const { deleted } = invoke(command('nodes.node.delete_with_undo')!, { nodes: ['a'] }, { session: sid });
    expect(broken()).toEqual(['a-x', 'a-y']);
    expect(invoke(command('nodes.node.restore')!, { deleted }, { session: sid })).toEqual({ nodes: ['a'], skipped: [] });
    expect(broken()).toEqual([]);
    expect(graph().edges.map((e) => e.id).sort()).toEqual(['a-x', 'a-y', 'b-x']);
  });

  it('rewiring one single input leaves a broken cable at another input', () => {
    install({ nodes: [text('old'), text('new'), asset('a'), image('x')], edges: [edge('prompt', 'old', 'x', 'prompt'), edge('reference', 'a', 'x', 'ref')] });
    expect(deleteNodes(sid, ['old', 'a'])).toBeNull();
    expect(tryConnect(sid, { source: 'new', target: 'x', targetHandle: 'prompt' })).toBe(true);
    expect(broken()).toEqual(['reference']);
    expect(inspectNode(sid, 'x')!.inputs).toEqual(expect.arrayContaining([expect.objectContaining({ edgeId: 'reference', broken: true })]));
  });
});
