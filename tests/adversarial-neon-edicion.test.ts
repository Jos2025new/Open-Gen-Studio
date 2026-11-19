import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset, Generation, Graph, GraphNode } from '../src/engine/types';

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
import { consumersOf } from '../src/engine/nodecore/deps';
import { descriptorOf } from '../src/engine/nodecore/registry';
import { sourceValue, storeEnv } from '../src/engine/nodecore/resolver';
import { createSession, useStore } from '../src/store/store';

const pos = { x: 0, y: 0 };
const settings = { count: 1, advanced: {} };
const textNode = (id: string, text = 'red'): GraphNode => ({ id, position: pos, data: { kind: 'text', title: id, text } });
const assetNode = (id: string, assetId: string | null): GraphNode => ({ id, position: pos, data: { kind: 'asset', title: id, assetId } });
const imageNode = (id: string, extra: Record<string, unknown> = {}): GraphNode => ({
  id,
  position: pos,
  data: { kind: 'image', title: id, prompt: 'local', modelRef: 'local::image', settings, outputIndex: 0, ...extra } as GraphNode['data'],
});

let sid: string;
const graph = () => useStore.getState().sessions[sid].graph;
const inspect = (node: string) => invoke(command('nodes.node.inspect')!, { node }, { session: sid }).inspection;
const install = (g: Graph, extra: Record<string, unknown> = {}) => {
  const s = { ...createSession('Edit & resolver adversarial neon'), graph: g };
  sid = s.id;
  useStore.setState({ activeSessionId: sid, sessions: { [sid]: s }, generations: {}, assets: {}, ...extra });
};

beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected network request'); });
});

describe('editing preconditions, parallel paths and resolver contract (neon adversarial)', () => {
  it('refuses a blind nodes.node.edit from a different caller on a node created by another caller', async () => {
    install({ nodes: [], edges: [] });
    const created = await run(
      { cmd: 'nodes.node.add', args: { data: { kind: 'text', title: 'Prompt', text: 'owned by cli' }, position: pos }, on: { session: sid } },
      { caller: 'cli' },
    );
    expect(created.ok).toBe(true);
    const { node } = created.results[0] as { node: string };

    const hijacked = await run(
      { cmd: 'nodes.node.edit', args: { node, patch: { text: 'blindly overwritten by agent' } }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(hijacked.ok).toBe(false);
    expect(graph().nodes[0].data).toMatchObject({ text: 'owned by cli' });
  });

  it('refuses a stale blind nodes.node.edit after an earlier blind command already updated the node', async () => {
    install({ nodes: [], edges: [] });
    const added = await run(
      { cmd: 'nodes.node.add', args: { data: imageNode('tmp').data, position: pos }, on: { session: sid } },
      { caller: 'agent' },
    );
    const { node, rev } = added.results[0] as { node: string; rev: string };

    // Both commands name the revision they read (the one the add returned): the first wins, the delayed one is stale.
    const newer = await run(
      { cmd: 'nodes.node.edit', args: { node, expect: rev, patch: { settings: { count: 3, advanced: {} } } }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(newer.ok).toBe(true);

    // Delayed command carrying an older draft (count: 1) and the older revision must not overwrite count: 3.
    const delayed = await run(
      { cmd: 'nodes.node.edit', args: { node, expect: rev, patch: { settings: { count: 1, aspect: '16:9', advanced: {} } } }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(delayed.ok).toBe(false);
    expect(graph().nodes[0].data).toMatchObject({ settings: { count: 3 } });
  });

  it('refuses changing a node kind or writing unowned fields through nodes.node.edit', async () => {
    install({ nodes: [textNode('t', 'hello')], edges: [] });
    const rev = inspect('t').revision;
    const corrupted = await run(
      { cmd: 'nodes.node.edit', args: { node: 't', expect: rev, patch: { kind: 'image', prompt: 'corrupted' } }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(corrupted.ok).toBe(false);
    expect(graph().nodes[0].data.kind).toBe('text');
  });

  it('returns a structured error instead of crashing when preparing a node whose subject source was deleted', async () => {
    install({
      nodes: [imageNode('src'), imageNode('dst', { subjects: [{ name: 'Hero', from: 'src' }] })],
      edges: [],
    });
    expect((await run({ cmd: 'nodes.node.delete', args: { nodes: ['src'] }, on: { session: sid } }, { caller: 'agent' })).ok).toBe(true);

    const prep = await run({ cmd: 'nodes.action.prepare', args: { targets: ['dst'] }, on: { session: sid } }, { caller: 'agent' });
    expect(prep).toMatchObject({ ok: false, error: { message: expect.stringContaining('Missing input node: src') } });
  });

  it('keeps freshness consistent with descriptor.affects when a port declares affects: false', () => {
    const gDone = {
      id: 'g1', sessionId: sid, kind: 'image', status: 'done', prompt: 'red\nlocal', modelRef: 'local::image',
      assetIds: ['a1'], settings, inputs: { refs: [] },
    } as unknown as Generation;
    install({
      nodes: [textNode('t', 'red'), imageNode('gen', { generationId: 'g1' })],
      edges: [{ id: 'e1', source: 't', target: 'gen', sourceHandle: 'out', targetHandle: 'prompt' }],
    }, { generations: { g1: gDone } });

    const d = descriptorOf('image')!;
    const saved = d.affects;
    (d as { affects: Record<string, boolean> }).affects = { ...saved, prompt: false };
    try {
      expect(inspect('gen').fresh).toBe(true);
      expect(consumersOf(graph(), ['t'])).toEqual([]);
      useStore.setState((st) => ({
        sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { ...graph(), nodes: [textNode('t', 'blue'), graph().nodes[1]] } } },
      }));
      expect(inspect('gen').fresh).toBe(true);
    } finally {
      (d as { affects: unknown }).affects = saved;
    }
  });

  it('resolves text from a connected system prompt node through the common resolver and prepareAction', async () => {
    install({
      nodes: [
        { id: 'p', position: pos, data: { kind: 'ref', type: 'prompt', ref: 'custom', title: 'Prompt box', promptText: 'golden sunset' } },
        imageNode('gen', { prompt: '' }),
      ],
      edges: [],
    });
    const rev = inspect('gen').revision;
    const linked = await run(
      { cmd: 'nodes.edit.connect', args: { source: 'p', target: 'gen', targetHandle: 'prompt', expect: { gen: rev } }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(linked.ok).toBe(true);
    expect(inspect('gen').inputs[0]).toMatchObject({ status: 'ok', value: 'golden sunset' });
    const prep = await run({ cmd: 'nodes.action.prepare', args: { targets: ['gen'] }, on: { session: sid } }, { caller: 'agent' });
    expect(prep.ok).toBe(true);
  });

  it('marks a pinned cable as invalid (pinMoved) when its source output becomes null', async () => {
    install({
      nodes: [assetNode('a', 'img1'), imageNode('gen')],
      edges: [{ id: 'e1', source: 'a', target: 'gen', sourceHandle: 'out', targetHandle: 'ref' }],
    }, { assets: { img1: { id: 'img1', kind: 'image', name: 'img1' } as Asset } });
    const pin = sourceValue(graph().nodes[0], {}, storeEnv()).revision!;
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { ...graph(), edges: [{ ...graph().edges[0], pin }] } } },
    }));
    expect(inspect('gen').inputs[0]).toMatchObject({ status: 'ok', revision: pin });

    const clear = await run(
      { cmd: 'nodes.edit.set', args: { node: 'a', patch: { assetId: null }, expect: { a: inspect('a').revision } }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(clear.ok).toBe(true);
    expect(inspect('gen').inputs[0]).toMatchObject({ status: 'invalid', pinMoved: true });
  });

  it('rejects unowned parameters and stale revisions through nodes.edit.set', async () => {
    install({ nodes: [textNode('t', 'v1')], edges: [] });
    const rev = inspect('t').revision;
    const unowned = await run(
      { cmd: 'nodes.edit.set', args: { node: 't', patch: { prompt: 'nope' }, expect: { t: rev } }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(unowned.ok).toBe(false);
    const ok = await run(
      { cmd: 'nodes.edit.set', args: { node: 't', patch: { text: 'v2' }, expect: { t: rev } }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(ok.ok).toBe(true);
    const stale = await run(
      { cmd: 'nodes.edit.set', args: { node: 't', patch: { text: 'v3' }, expect: { t: rev } }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(stale.ok).toBe(false);
    expect(graph().nodes[0].data).toMatchObject({ text: 'v2' });
  });
});
