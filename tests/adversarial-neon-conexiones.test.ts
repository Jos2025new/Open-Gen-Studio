import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset, Graph } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));

import { command, invoke, run } from '../src/engine/commands';
import { createSession, useStore } from '../src/store/store';

const pos = { x: 0, y: 0 };
const settings = { count: 1, advanced: {} };
const textNode = (id: string, text = id) => ({ id, position: pos, data: { kind: 'text' as const, title: id, text } });
const assetNode = (id: string, assetId: string) => ({ id, position: pos, data: { kind: 'asset' as const, title: id, assetId } });
const imageNode = (id: string) => ({ id, position: pos, data: { kind: 'image' as const, title: id, prompt: '', modelRef: 'local::image', settings, outputIndex: 0 } });
const modelNode = (id: string, ref: string) => ({ id, position: pos, data: { kind: 'ref' as const, type: 'model' as const, ref, title: id, mediaKind: 'image' as const } });

let sid: string;
const graph = () => useStore.getState().sessions[sid].graph;
const call = (cmd: string, args: unknown) => run({ cmd, args, on: { session: sid } }, { caller: 'agent' });
const inspect = (node: string) => invoke(command('nodes.node.inspect')!, { node }, { session: sid }).inspection;
const install = (g: Graph) => {
  const s = { ...createSession('Connections adversarial neon'), graph: g };
  sid = s.id;
  const assets = Object.fromEntries(['a', 'b'].map((id) => [id, { id, kind: 'image', name: id } as Asset]));
  useStore.setState({ activeSessionId: sid, sessions: { [sid]: s }, assets });
};

beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected network request'); });
});

describe('connections, broken cables and silent replacement (neon adversarial)', () => {
  it('allows removing a broken cable on a multi-cable port through nodes.edge.disconnect', async () => {
    install({
      nodes: [assetNode('a', 'a'), assetNode('b', 'b'), imageNode('x')],
      edges: [
        { id: 'lost', source: 'a', target: 'x', sourceHandle: 'out', targetHandle: 'ref' },
        { id: 'live', source: 'b', target: 'x', sourceHandle: 'out', targetHandle: 'ref' },
      ],
    });
    expect((await call('nodes.node.delete', { nodes: ['a'] })).ok).toBe(true);
    expect(graph().broken?.map((b) => b.edge.id)).toEqual(['lost']);

    const removed = await call('nodes.edge.disconnect', { edges: ['lost'] });
    expect(removed.ok).toBe(true);
    expect(graph().broken ?? []).toEqual([]);
    expect(graph().edges.map((e) => e.id)).toEqual(['live']);
  });

  it('refuses silent replacement on an occupied single-cable port via nodes.edge.connect', async () => {
    install({
      nodes: [textNode('t1', 'first'), textNode('t2', 'second'), imageNode('gen')],
      edges: [{ id: 'e1', source: 't1', target: 'gen', sourceHandle: 'out', targetHandle: 'prompt' }],
    });
    const res = await call('nodes.edge.connect', { source: 't2', target: 'gen', target_handle: 'prompt' });
    expect(res.ok).toBe(false);
    expect(graph().edges.map((e) => e.id)).toEqual(['e1']);
  });

  it('rejects a stale replaces precondition on an empty single-cable system port (model) in nodes.edit.connect', async () => {
    install({
      nodes: [modelNode('m1', 'local::image'), modelNode('m2', 'local::image'), imageNode('gen')],
      edges: [{ id: 'e-model', source: 'm1', target: 'gen', sourceHandle: 'model', targetHandle: 'model', kind: 'control' }],
    });
    expect((await call('nodes.edge.disconnect', { edges: ['e-model'] })).ok).toBe(true);
    const rev = inspect('gen').revision;

    const stale = await call('nodes.edit.connect', {
      source: 'm2',
      target: 'gen',
      targetHandle: 'model',
      kind: 'control',
      replaces: 'e-model',
      expect: { gen: rev },
    });
    expect(stale.ok).toBe(false);
    expect(graph().edges).toEqual([]);
  });

  it('preserves a pinned incoming reference when duplicating its consumer via nodes.node.duplicate', async () => {
    install({
      nodes: [textNode('src', 'current text'), imageNode('gen')],
      edges: [{ id: 'pinned', source: 'src', target: 'gen', sourceHandle: 'out', targetHandle: 'prompt', pin: 'stale-rev' }],
    });
    expect(inspect('gen').inputs).toEqual([expect.objectContaining({ status: 'invalid', pinMoved: true })]);

    const dup = await call('nodes.node.duplicate', { node: 'gen' });
    expect(dup.ok).toBe(true);
    const { node: copyId } = dup.results[0] as { node: string };
    expect(inspect(copyId).inputs).toEqual([expect.objectContaining({ status: 'invalid', pinMoved: true })]);
  });

  it('keeps outgoing ref and control links when changing a generation node model via nodes.node.set_model', async () => {
    install({
      nodes: [imageNode('gen'), imageNode('other')],
      edges: [
        { id: 'r1', source: 'gen', target: 'other', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref' },
        { id: 'c1', source: 'gen', target: 'other', sourceHandle: 'out_control', targetHandle: 'control', kind: 'control' },
      ],
    });
    const res = await call('nodes.node.set_model', { node: 'gen', model: 'local::image', settings });
    expect(res.ok).toBe(true);
    expect(graph().edges.map((e) => e.id).sort()).toEqual(['c1', 'r1']);
  });

  it('round-trips a deleted node with a pinned cable through nodes.node.delete_with_undo and nodes.node.restore', async () => {
    install({
      nodes: [textNode('src', 'red'), imageNode('gen')],
      edges: [{ id: 'e1', source: 'src', target: 'gen', sourceHandle: 'out', targetHandle: 'prompt', pin: 'old-pin' }],
    });
    const removed = await call('nodes.node.delete_with_undo', { nodes: ['src'] });
    expect(removed.ok).toBe(true);
    const { deleted } = removed.results[0] as { deleted: unknown };

    const restored = await call('nodes.node.restore', { deleted });
    expect(restored.ok).toBe(true);
    expect(graph().edges).toEqual([expect.objectContaining({ id: 'e1', pin: 'old-pin' })]);
  });

  it('preserves sourceHandle out-2 and outputIndex when connecting via nodes.edit.connect with kind data', async () => {
    install({
      nodes: [imageNode('src'), imageNode('dst')],
      edges: [],
    });
    const rev = inspect('dst').revision;
    const res = await call('nodes.edit.connect', {
      source: 'src',
      target: 'dst',
      sourceHandle: 'out-2',
      targetHandle: 'ref',
      kind: 'data',
      expect: { dst: rev },
    });
    expect(res.ok).toBe(true);
    expect(graph().edges[0]).toMatchObject({ sourceHandle: 'out-2', outputIndex: 1 });
  });

  it('does not silently strip a pin when re-wiring the same source without naming replaces', async () => {
    install({
      nodes: [textNode('src', 'blue'), imageNode('gen')],
      edges: [{ id: 'e1', source: 'src', target: 'gen', sourceHandle: 'out', targetHandle: 'prompt', pin: 'old-red-rev' }],
    });
    const rev = inspect('gen').revision;
    const res = await call('nodes.edit.connect', {
      source: 'src',
      target: 'gen',
      targetHandle: 'prompt',
      expect: { gen: rev },
    });
    expect(res.ok).toBe(false);
    expect(graph().edges).toEqual([expect.objectContaining({ id: 'e1', pin: 'old-red-rev' })]);
  });

  it('rejects a self-loop and a two-node data cycle through nodes.edit.connect', async () => {
    install({
      nodes: [imageNode('a'), imageNode('b')],
      edges: [{ id: 'ab', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'ref' }],
    });
    const selfRes = await call('nodes.edit.connect', {
      source: 'a', target: 'a', targetHandle: 'ref', expect: { a: inspect('a').revision },
    });
    expect(selfRes.ok).toBe(false);
    const cycleRes = await call('nodes.edit.connect', {
      source: 'b', target: 'a', targetHandle: 'ref', expect: { a: inspect('a').revision },
    });
    expect(cycleRes.ok).toBe(false);
    expect(graph().edges.map((e) => e.id)).toEqual(['ab']);
  });
});
