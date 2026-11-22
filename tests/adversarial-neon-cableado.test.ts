import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { run } from '../src/engine/commands';
import { tryConnect } from '../src/engine/flow/actions';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import { applyEdit } from '../src/engine/nodecore/edit';
import { ownerRev } from '../src/engine/nodecore/revision';
import { linkSystemNodes } from '../src/engine/nodes/system';
import { clearJourneyTrace } from '../src/lib/journeyTrace';
import { createSession, setGraph, useStore } from '../src/store/store';
import type { GenNodeData, Graph, GraphEdge, GraphNode, LinkKind } from '../src/engine/types';

const settings = { count: 1, advanced: {} };
const pos = { x: 0, y: 0 };

const textNode = (id: string, text = id): GraphNode => ({
  id,
  position: pos,
  data: { kind: 'text', title: id, text },
});

const imgNode = (id: string, extra: Partial<GenNodeData> = {}): GraphNode => ({
  id,
  position: pos,
  data: { kind: 'image', title: id, prompt: '', modelRef: 'local::studio-image', settings, outputIndex: 0, ...extra },
});

const vidNode = (id: string): GraphNode => ({
  id,
  position: pos,
  data: { kind: 'video', title: id, prompt: '', modelRef: 'local::studio-video', settings, outputIndex: 0 },
});

const toolNode = (id: string): GraphNode => ({
  id,
  position: pos,
  data: { kind: 'tool', title: id, op: 'relight', params: {}, outputIndex: 0 },
});

const modelNode = (id: string, ref: string, mediaKind: 'image' | 'video' | 'llm' = 'image'): GraphNode => ({
  id,
  position: pos,
  data: { kind: 'ref', type: 'model', ref, title: id, mediaKind, attachMode: 'wired' },
});

let sid = '';
const session = () => useStore.getState().sessions[sid];
const graph = () => session().graph;
const call = (cmd: string, args: unknown) => run({ cmd, args, on: { session: sid } }, { caller: 'agent' });
const undo = () => travelGraph(sid, graph(), 'undo', 1, (next) => { setGraph(sid, () => next); return true; });

const install = (g: Graph) => {
  setGraph(sid, () => g);
};

beforeEach(() => {
  const s = createSession('Adversarial cableado');
  sid = s.id;
  useStore.setState((st) => ({ activeSessionId: sid, sessions: { ...st.sessions, [sid]: s } }));
  clearJourneyTrace();
});

describe('1. pinned cables (pin)', () => {
  it.each(['nodes.edge.connect', 'nodes.system.link'] as const)(
    'rejects rewiring the same source onto a pinned cable without naming replaces via %s (multi:false and multi:true)',
    async (cmdPath) => {
      // multi:false (prompt) and multi:true (ref)
      for (const tc of [
        {
          name: 'multi:false prompt',
          nodes: [textNode('t1', 'hello'), imgNode('img')],
          edge: { id: 'e_pin_prompt', source: 't1', target: 'img', sourceHandle: 'out', targetHandle: 'prompt', pin: 'rev-1' } as GraphEdge,
          args: { source: 't1', target: 'img', target_handle: 'prompt', kind: 'data' as LinkKind },
        },
        {
          name: 'multi:true ref',
          nodes: [imgNode('a'), imgNode('b')],
          edge: { id: 'e_pin_ref', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'ref', pin: 'rev-2' } as GraphEdge,
          args: { source: 'a', target: 'b', target_handle: 'ref', kind: 'data' as LinkKind },
        },
        {
          name: 'multi:false model (control)',
          nodes: [modelNode('m1', 'local::m1'), imgNode('img')],
          edge: { id: 'e_pin_model', source: 'm1', target: 'img', sourceHandle: 'model', targetHandle: 'model', kind: 'control', pin: 'rev-3' } as GraphEdge,
          args: { source: 'm1', target: 'img', source_handle: 'model', target_handle: 'model', kind: 'control' as LinkKind },
        },
      ]) {
        install({ nodes: tc.nodes, edges: [tc.edge] });
        const snap = structuredClone(graph());

        const blind = await call(cmdPath, tc.args);
        expect(blind.ok, `${cmdPath} blind ${tc.name}`).toBe(false);
        expect(graph(), `${cmdPath} blind no mutation ${tc.name}`).toEqual(snap);

        const named = await call(cmdPath, { ...tc.args, replaces: tc.edge.id });
        expect(named.ok, `${cmdPath} named replaces ${tc.name}`).toBe(true);
        expect(graph().edges).toHaveLength(1);
        expect(graph().edges[0].pin).toBeUndefined();
      }
    },
  );

  it.each(['nodes.edge.connect', 'nodes.system.link'] as const)(
    'rejects replacing a pinned cable with another source without naming replaces via %s',
    async (cmdPath) => {
      install({
        nodes: [textNode('t1', 'one'), textNode('t2', 'two'), imgNode('img')],
        edges: [{ id: 'e_pin', source: 't1', target: 'img', sourceHandle: 'out', targetHandle: 'prompt', pin: 'rev-1' }],
      });
      const snap = structuredClone(graph());

      const blind = await call(cmdPath, { source: 't2', target: 'img', target_handle: 'prompt', kind: 'data' });
      expect(blind.ok).toBe(false);
      expect(graph()).toEqual(snap);

      const named = await call(cmdPath, { source: 't2', target: 'img', target_handle: 'prompt', kind: 'data', replaces: 'e_pin' });
      expect(named.ok).toBe(true);
      expect(graph().edges.map((e) => [e.source, e.targetHandle, e.pin])).toEqual([['t2', 'prompt', undefined]]);
    },
  );

  it('direct applyEdit(connect) without replaces must not silently replace an occupied single-cable port or strip a pin', () => {
    // Occupied single-cable port
    install({
      nodes: [textNode('t1', 'one'), textNode('t2', 'two'), imgNode('img')],
      edges: [{ id: 'e1', source: 't1', target: 'img', sourceHandle: 'out', targetHandle: 'prompt' }],
    });
    const rev = ownerRev(graph(), 'img');
    const overwrite = applyEdit({
      session: sid,
      require: true,
      expect: { img: rev },
      op: { op: 'connect', source: 't2', target: 'img', targetHandle: 'prompt' },
    });
    expect(overwrite.ok).toBe(false);
    expect(graph().edges.map((e) => e.id)).toEqual(['e1']);

    // Pinned same-source cable
    install({
      nodes: [textNode('t1', 'one'), imgNode('img')],
      edges: [{ id: 'e_pin', source: 't1', target: 'img', sourceHandle: 'out', targetHandle: 'prompt', pin: 'rev-1' }],
    });
    const pinRev = ownerRev(graph(), 'img');
    const stripPin = applyEdit({
      session: sid,
      require: true,
      expect: { img: pinRev },
      op: { op: 'connect', source: 't1', target: 'img', targetHandle: 'prompt' },
    });
    expect(stripPin.ok).toBe(false);
    expect(graph().edges).toEqual([expect.objectContaining({ id: 'e_pin', pin: 'rev-1' })]);
  });

  it('direct linkSystemNodes without replaces must not silently strip a pin when rewiring the same source', () => {
    install({
      nodes: [imgNode('a'), imgNode('b')],
      edges: [{ id: 'e_pin', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'ref', pin: 'rev-keep' }],
    });
    const res = linkSystemNodes(sid, { source: 'a', target: 'b', kind: 'data', targetHandle: 'ref' });
    expect(res.error).not.toBeNull();
    expect(graph().edges).toEqual([expect.objectContaining({ id: 'e_pin', pin: 'rev-keep' })]);
  });
});

describe('2. idempotent rewiring (same source -> same port)', () => {
  const wireAll3 = async (
    path: 'canvas' | 'nodes.edge.connect' | 'nodes.system.link',
    spec: { source: string; target: string; sourceHandle?: string; targetHandle: string | null; kind: LinkKind },
  ) => {
    if (path === 'canvas') {
      return tryConnect(sid, {
        source: spec.source,
        target: spec.target,
        sourceHandle: spec.sourceHandle ?? null,
        targetHandle: spec.targetHandle,
        kind: spec.kind === 'data' ? undefined : spec.kind,
      });
    }
    if (path === 'nodes.edge.connect') {
      const r = await call('nodes.edge.connect', {
        source: spec.source,
        target: spec.target,
        source_handle: spec.sourceHandle ?? null,
        target_handle: spec.targetHandle,
        ...(spec.kind === 'data' ? {} : { kind: spec.kind }),
      });
      return r.ok;
    }
    const r = await call('nodes.system.link', {
      source: spec.source,
      target: spec.target,
      kind: spec.kind,
      ...(spec.sourceHandle ? { source_handle: spec.sourceHandle } : {}),
      ...(spec.targetHandle ? { target_handle: spec.targetHandle } : {}),
    });
    return r.ok;
  };

  it.each(['canvas', 'nodes.edge.connect', 'nodes.system.link'] as const)(
    'is idempotent without replaces and does not duplicate on %s (single, multi, control, ref)',
    async (path) => {
      const cases = [
        {
          name: 'multi:false data (prompt)',
          nodes: [textNode('t1', 'hi'), imgNode('img')],
          spec: { source: 't1', target: 'img', targetHandle: 'prompt', kind: 'data' as LinkKind },
        },
        {
          name: 'multi:true data (ref)',
          nodes: [imgNode('a'), imgNode('b')],
          spec: { source: 'a', target: 'b', targetHandle: 'ref', kind: 'data' as LinkKind },
        },
        {
          name: 'multi:false control (model)',
          nodes: [modelNode('m1', 'local::m1'), imgNode('img')],
          spec: { source: 'm1', target: 'img', sourceHandle: 'model', targetHandle: 'model', kind: 'control' as LinkKind },
        },
        {
          name: 'multi:true ref (sys_ref)',
          nodes: [imgNode('a'), vidNode('v')],
          spec: { source: 'a', target: 'v', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref' as LinkKind },
        },
      ];

      for (const tc of cases) {
        install({ nodes: tc.nodes, edges: [] });
        expect(await wireAll3(path, tc.spec), `first ${path} ${tc.name}`).toBe(true);
        expect(graph().edges, `count1 ${path} ${tc.name}`).toHaveLength(1);

        expect(await wireAll3(path, tc.spec), `second ${path} ${tc.name}`).toBe(true);
        expect(graph().edges, `count2 ${path} ${tc.name}`).toHaveLength(1);
        expect(graph().edges[0]).toMatchObject({
          source: tc.spec.source,
          target: tc.spec.target,
          targetHandle: tc.spec.targetHandle,
        });
      }
    },
  );

  it('treats different numbered outputs from the same source as distinct cables on multi:false, and same out-2 as idempotent', async () => {
    install({ nodes: [imgNode('src'), vidNode('vid')], edges: [] });
    expect((await call('nodes.edge.connect', { source: 'src', target: 'vid', source_handle: 'out-2', target_handle: 'first' })).ok).toBe(true);
    const firstId = graph().edges[0].id;

    // Rewiring exact same out-2 is idempotent (no replaces needed)
    expect((await call('nodes.edge.connect', { source: 'src', target: 'vid', source_handle: 'out-2', target_handle: 'first' })).ok).toBe(true);
    expect(graph().edges).toHaveLength(1);
    expect(graph().edges[0]).toMatchObject({ sourceHandle: 'out-2', outputIndex: 1 });
    const afterIdempotentId = graph().edges[0].id;
    expect(afterIdempotentId).not.toBe('');

    // Switching from out-2 to out-3 on multi:false port is a replacement, not idempotent
    const blindSwitch = await call('nodes.system.link', { source: 'src', target: 'vid', kind: 'data', source_handle: 'out-3', target_handle: 'first' });
    expect(blindSwitch.ok).toBe(false);
    expect(graph().edges).toHaveLength(1);
    expect(graph().edges[0]).toMatchObject({ sourceHandle: 'out-2', outputIndex: 1 });

    const namedSwitch = await call('nodes.system.link', {
      source: 'src',
      target: 'vid',
      kind: 'data',
      source_handle: 'out-3',
      target_handle: 'first',
      replaces: afterIdempotentId,
    });
    expect(namedSwitch.ok).toBe(true);
    expect(graph().edges).toHaveLength(1);
    expect(graph().edges[0]).toMatchObject({ sourceHandle: 'out-3', outputIndex: 2 });
    expect(firstId).toBeTruthy();
  });
});

describe('3. descriptor cardinality (multi:false and multi:true creative data inputs across all 3 paths)', () => {
  it.each(['canvas', 'nodes.edge.connect', 'nodes.system.link'] as const)(
    'enforces multi:false on creative data ports (video.first and tool.input) with single-undo replacement via %s',
    async (path) => {
      for (const tc of [
        { name: 'video.first', nodes: [imgNode('a'), imgNode('b'), vidNode('tgt')], targetHandle: 'first' },
        { name: 'tool.input', nodes: [imgNode('a'), imgNode('b'), toolNode('tgt')], targetHandle: 'input' },
      ]) {
        install({ nodes: tc.nodes, edges: [] });

        const wire = async (source: string, replaces?: string | null) => {
          if (path === 'canvas') return tryConnect(sid, { source, target: 'tgt', targetHandle: tc.targetHandle });
          if (path === 'nodes.edge.connect') {
            return (await call('nodes.edge.connect', {
              source,
              target: 'tgt',
              target_handle: tc.targetHandle,
              ...(replaces !== undefined ? { replaces } : {}),
            })).ok;
          }
          return (await call('nodes.system.link', {
            source,
            target: 'tgt',
            kind: 'data',
            target_handle: tc.targetHandle,
            ...(replaces !== undefined ? { replaces } : {}),
          })).ok;
        };

        expect(await wire('a'), `first ${path} ${tc.name}`).toBe(true);
        const firstEdges = structuredClone(graph().edges);
        expect(firstEdges).toHaveLength(1);
        const stepsBefore = graphHistory(sid, 'undo').length;

        if (path !== 'canvas') {
          expect(await wire('b'), `blind second ${path} ${tc.name}`).toBe(false);
          expect(graph().edges).toEqual(firstEdges);
        }

        expect(await wire('b', firstEdges[0].id), `replace ${path} ${tc.name}`).toBe(true);
        expect(graph().edges.map((e) => [e.source, e.targetHandle])).toEqual([['b', tc.targetHandle]]);
        expect(graphHistory(sid, 'undo')).toHaveLength(stepsBefore + 1);
        expect(undo()).toBe(true);
        expect(graph().edges).toEqual(firstEdges);
      }
    },
  );

  it.each(['canvas', 'nodes.edge.connect', 'nodes.system.link'] as const)(
    'allows multiple sources on multi:true creative data port (image.ref) via %s',
    async (path) => {
      install({ nodes: [imgNode('a'), imgNode('b'), imgNode('tgt')], edges: [] });

      const wire = async (source: string) => {
        if (path === 'canvas') return tryConnect(sid, { source, target: 'tgt', targetHandle: 'ref' });
        if (path === 'nodes.edge.connect') {
          return (await call('nodes.edge.connect', { source, target: 'tgt', target_handle: 'ref' })).ok;
        }
        return (await call('nodes.system.link', { source, target: 'tgt', kind: 'data', target_handle: 'ref' })).ok;
      };

      expect(await wire('a')).toBe(true);
      expect(await wire('b')).toBe(true);
      expect(graph().edges.map((e) => e.source).sort()).toEqual(['a', 'b']);
      expect(graph().edges.every((e) => e.targetHandle === 'ref')).toBe(true);
    },
  );
});

