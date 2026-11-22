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

import { threadOf } from '../src/engine/agent/lanes';
import { run } from '../src/engine/commands';
import { deleteNodes, tryConnect } from '../src/engine/flow/actions';
import { cablePortProblem, connect, GONE_HANDLE, NO_RESULT, resolveWiring } from '../src/engine/flow/graph';
import { ensureSystemNodes, linkSystemNodes } from '../src/engine/nodes/system';
import { clearJourneyTrace, lastJourneyTrace } from '../src/lib/journeyTrace';
import { createSession, setGraph, useStore } from '../src/store/store';
import type { GenNodeData, Graph, GraphEdge, GraphNode } from '../src/engine/types';

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

const modelNode = (id: string, ref: string, mediaKind: 'image' | 'video' | 'llm' = 'image'): GraphNode => ({
  id,
  position: pos,
  data: { kind: 'ref', type: 'model', ref, title: id, mediaKind, attachMode: 'wired' },
});

let sid = '';
const session = () => useStore.getState().sessions[sid];
const graph = () => session().graph;
const call = (cmd: string, args: unknown) => run({ cmd, args, on: { session: sid } }, { caller: 'agent' });
const install = (g: Graph) => {
  setGraph(sid, () => g);
};

beforeEach(() => {
  const s = createSession('Adversarial cableado');
  sid = s.id;
  useStore.setState((st) => ({ activeSessionId: sid, sessions: { ...st.sessions, [sid]: s } }));
  clearJourneyTrace();
});

describe('4. numbered results and GONE_HANDLE / outputIndex', () => {
  it.each(['canvas', 'nodes.edge.connect', 'nodes.system.link'] as const)(
    'preserves numbered sourceHandle (out-2) and outputIndex: 1 via %s',
    async (path) => {
      install({ nodes: [imgNode('src'), imgNode('dst')], edges: [] });

      if (path === 'canvas') {
        expect(tryConnect(sid, { source: 'src', target: 'dst', sourceHandle: 'out-2', targetHandle: 'ref' })).toBe(true);
      } else if (path === 'nodes.edge.connect') {
        expect((await call('nodes.edge.connect', { source: 'src', target: 'dst', source_handle: 'out-2', target_handle: 'ref' })).ok).toBe(true);
      } else {
        expect((await call('nodes.system.link', { source: 'src', target: 'dst', kind: 'data', source_handle: 'out-2', target_handle: 'ref' })).ok).toBe(true);
      }

      expect(graph().edges).toHaveLength(1);
      expect(graph().edges[0]).toMatchObject({
        source: 'src',
        target: 'dst',
        sourceHandle: 'out-2',
        targetHandle: 'ref',
        outputIndex: 1,
      });
    },
  );

  it.each(['canvas', 'nodes.edge.connect', 'nodes.system.link'] as const)(
    'keeps GONE_HANDLE and outputIndex: NO_RESULT on a lost-result cable via %s',
    async (path) => {
      install({ nodes: [imgNode('src'), imgNode('dst')], edges: [] });

      if (path === 'canvas') {
        expect(tryConnect(sid, { source: 'src', target: 'dst', sourceHandle: GONE_HANDLE, targetHandle: 'ref' })).toBe(true);
      } else if (path === 'nodes.edge.connect') {
        expect((await call('nodes.edge.connect', { source: 'src', target: 'dst', source_handle: GONE_HANDLE, target_handle: 'ref' })).ok).toBe(true);
      } else {
        expect((await call('nodes.system.link', { source: 'src', target: 'dst', kind: 'data', source_handle: GONE_HANDLE, target_handle: 'ref' })).ok).toBe(true);
      }

      expect(graph().edges).toHaveLength(1);
      expect(graph().edges[0]).toMatchObject({
        source: 'src',
        target: 'dst',
        sourceHandle: GONE_HANDLE,
        targetHandle: 'ref',
        outputIndex: NO_RESULT,
      });
    },
  );

  it('pure connect() preserves both out-3 (outputIndex 2) and GONE_HANDLE (NO_RESULT)', () => {
    const base: Graph = { nodes: [imgNode('src'), imgNode('dst')], edges: [] };
    const g1 = connect(base, { source: 'src', target: 'dst', sourceHandle: 'out-3', targetHandle: 'ref' });
    expect(g1.edges).toHaveLength(1);
    expect(g1.edges[0]).toMatchObject({ sourceHandle: 'out-3', outputIndex: 2 });

    const g2 = connect(base, { source: 'src', target: 'dst', sourceHandle: GONE_HANDLE, targetHandle: 'ref' });
    expect(g2.edges).toHaveLength(1);
    expect(g2.edges[0]).toMatchObject({ sourceHandle: GONE_HANDLE, outputIndex: NO_RESULT });
  });

  it('cablePortProblem agrees with resolveWiring for a GONE_HANDLE cable wired into a system node', () => {
    const src = imgNode('src');
    const space: GraphNode = {
      id: 'sys_space_create',
      position: pos,
      data: { kind: 'ref', type: 'space', ref: 'create', title: 'Create Space' },
    };
    const wiring = resolveWiring(src, space, {}, { sourceHandle: GONE_HANDLE, targetHandle: 'in', kind: 'data' });
    expect('error' in wiring).toBe(false);
    if ('error' in wiring) return;
    const edge: GraphEdge = { id: 'e_gone_sys', ...wiring.edge };
    expect(edge).toMatchObject({ sourceHandle: GONE_HANDLE, outputIndex: NO_RESULT, targetHandle: 'in', kind: 'data' });
    expect(cablePortProblem(src, space, {}, edge)).toBeNull();
  });
});

describe('5. data loops and bidirectional data (both) rejected across all 3 paths', () => {
  it.each(['canvas', 'nodes.edge.connect', 'nodes.system.link'] as const)(
    'rejects direct, transitive, self, and subject-binding data loops with zero mutation via %s',
    async (path) => {
      const attempt = async (source: string, target: string, targetHandle = 'ref') => {
        if (path === 'canvas') return tryConnect(sid, { source, target, targetHandle });
        if (path === 'nodes.edge.connect') {
          return (await call('nodes.edge.connect', { source, target, target_handle: targetHandle })).ok;
        }
        return (await call('nodes.system.link', { source, target, kind: 'data', target_handle: targetHandle })).ok;
      };

      // 2-node and 3-node data cycles + self-loop
      install({
        nodes: [imgNode('a'), imgNode('b'), imgNode('c')],
        edges: [
          { id: 'ab', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'ref' },
          { id: 'bc', source: 'b', target: 'c', sourceHandle: 'out', targetHandle: 'ref' },
        ],
      });
      const snap = structuredClone(graph());

      expect(await attempt('a', 'a'), `self ${path}`).toBe(false);
      expect(await attempt('b', 'a'), `2-cycle ${path}`).toBe(false);
      expect(await attempt('c', 'a'), `3-cycle ${path}`).toBe(false);
      expect(graph()).toEqual(snap);

      // Subject-binding cycle: a depends on b via subject, so wiring a -> b closes a data loop
      install({
        nodes: [imgNode('a', { subjects: [{ name: 'Hero', from: 'b' }] }), imgNode('b')],
        edges: [],
      });
      const subjSnap = structuredClone(graph());
      expect(await attempt('a', 'b'), `subject cycle ${path}`).toBe(false);
      expect(graph()).toEqual(subjSnap);
    },
  );

  it.each(['canvas', 'nodes.edge.connect', 'nodes.system.link'] as const)(
    'rejects both:true on data links (creative and system) and allows both:true on ref/control via %s',
    async (path) => {
      install({ nodes: [imgNode('a'), imgNode('b')], edges: [] });
      ensureSystemNodes(sid);
      const snap = structuredClone(graph());

      if (path === 'canvas') {
        expect(tryConnect(sid, { source: 'a', target: 'b', targetHandle: 'ref', both: true })).toBe(false);
        expect(tryConnect(sid, { source: 'sys_agent', target: 'sys_space_tools', targetHandle: 'in', kind: 'data', both: true })).toBe(false);
      } else if (path === 'nodes.edge.connect') {
        expect((await call('nodes.edge.connect', { source: 'a', target: 'b', target_handle: 'ref', both: true })).ok).toBe(false);
        expect((await call('nodes.edge.connect', { source: 'sys_agent', target: 'sys_space_tools', target_handle: 'in', kind: 'data', both: true })).ok).toBe(false);
      } else {
        expect((await call('nodes.system.link', { source: 'a', target: 'b', kind: 'data', target_handle: 'ref', both: true })).ok).toBe(false);
        expect((await call('nodes.system.link', { source: 'sys_agent', target: 'sys_space_tools', kind: 'data', both: true })).ok).toBe(false);
      }
      expect(graph()).toEqual(snap);

      // Non-data cycles + both:true are allowed
      if (path === 'canvas') {
        expect(tryConnect(sid, { source: 'a', target: 'b', sourceHandle: 'out_ref', targetHandle: 'sys_ref', both: true })).toBe(true);
        expect(tryConnect(sid, { source: 'b', target: 'a', sourceHandle: 'out_ref', targetHandle: 'sys_ref' })).toBe(true);
      } else if (path === 'nodes.edge.connect') {
        expect((await call('nodes.edge.connect', { source: 'a', target: 'b', source_handle: 'out_ref', target_handle: 'sys_ref', both: true })).ok).toBe(true);
        expect((await call('nodes.edge.connect', { source: 'b', target: 'a', source_handle: 'out_ref', target_handle: 'sys_ref' })).ok).toBe(true);
      } else {
        expect((await call('nodes.system.link', { source: 'a', target: 'b', kind: 'ref', source_handle: 'out_ref', target_handle: 'sys_ref', both: true })).ok).toBe(true);
        expect((await call('nodes.system.link', { source: 'b', target: 'a', kind: 'ref', source_handle: 'out_ref', target_handle: 'sys_ref' })).ok).toBe(true);
      }
      expect(graph().edges.find((e) => e.source === 'a' && e.target === 'b' && e.kind === 'ref')?.both).toBe(true);
    },
  );
});

describe('6. model -> agent copy and finishConnect / applyEdit side effects across all 3 paths', () => {
  it.each(['canvas', 'nodes.edge.connect', 'nodes.system.link'] as const)(
    'copies image and video modelRef to agent lane on model -> agent control link via %s',
    async (path) => {
      install({ nodes: [], edges: [] });
      ensureSystemNodes(sid);
      setGraph(sid, (g) => ({
        ...g,
        nodes: [
          ...g.nodes,
          modelNode('m_img', 'atlas::neon-img-model', 'image'),
          modelNode('m_vid', 'atlas::neon-vid-model', 'video'),
        ],
      }));

      const wireModel = async (source: string) => {
        if (path === 'canvas') {
          return tryConnect(sid, { source, target: 'sys_agent', sourceHandle: 'model', targetHandle: null });
        }
        if (path === 'nodes.edge.connect') {
          return (await call('nodes.edge.connect', { source, target: 'sys_agent', source_handle: 'model', target_handle: null })).ok;
        }
        return (await call('nodes.system.link', { source, target: 'sys_agent', kind: 'control' })).ok;
      };

      expect(await wireModel('m_img')).toBe(true);
      expect(await wireModel('m_vid')).toBe(true);

      const imgEdge = graph().edges.find((e) => e.source === 'm_img' && e.target === 'sys_agent');
      const vidEdge = graph().edges.find((e) => e.source === 'm_vid' && e.target === 'sys_agent');
      expect(imgEdge).toMatchObject({ sourceHandle: 'model', targetHandle: 'model', kind: 'control' });
      expect(vidEdge).toMatchObject({ sourceHandle: 'model', targetHandle: 'model', kind: 'control' });

      const lane = threadOf(session(), 'sys_agent');
      expect(lane?.settings?.image?.modelRef).toBe('atlas::neon-img-model');
      expect(lane?.settings?.video?.modelRef).toBe('atlas::neon-vid-model');
      expect(lastJourneyTrace().filter((e) => e.event === 'edit.connect').length).toBeGreaterThanOrEqual(2);
    },
  );

  it('does not copy modelRef to agent when linking model -> agent as ref or data', async () => {
    install({ nodes: [], edges: [] });
    ensureSystemNodes(sid);
    const before = threadOf(session(), 'sys_agent')?.settings?.image?.modelRef;
    setGraph(sid, (g) => ({
      ...g,
      nodes: [...g.nodes, modelNode('m_other', 'atlas::should-not-copy', 'image')],
    }));

    expect((await call('nodes.system.link', { source: 'm_other', target: 'sys_agent', kind: 'ref' })).ok).toBe(true);
    expect((await call('nodes.system.link', { source: 'm_other', target: 'sys_agent', kind: 'data' })).ok).toBe(true);
    expect(threadOf(session(), 'sys_agent')?.settings?.image?.modelRef).toBe(before);
  });

  it.each(['canvas', 'nodes.edge.connect', 'nodes.system.link'] as const)(
    'repairs a broken tombstone on a single-cable port and keeps it on a multi-cable port via %s',
    async (path) => {
      install({
        nodes: [textNode('t1', 'old'), textNode('t2', 'new'), imgNode('a'), imgNode('b'), imgNode('dst')],
        edges: [
          { id: 'e_prompt', source: 't1', target: 'dst', sourceHandle: 'out', targetHandle: 'prompt' },
          { id: 'e_ref', source: 'a', target: 'dst', sourceHandle: 'out', targetHandle: 'ref' },
        ],
      });
      expect(deleteNodes(sid, ['t1', 'a'])).toBeNull();
      expect(graph().broken?.map((b) => b.edge.id).sort()).toEqual(['e_prompt', 'e_ref']);

      if (path === 'canvas') {
        expect(tryConnect(sid, { source: 't2', target: 'dst', targetHandle: 'prompt' })).toBe(true);
        expect(tryConnect(sid, { source: 'b', target: 'dst', targetHandle: 'ref' })).toBe(true);
      } else if (path === 'nodes.edge.connect') {
        expect((await call('nodes.edge.connect', { source: 't2', target: 'dst', target_handle: 'prompt' })).ok).toBe(true);
        expect((await call('nodes.edge.connect', { source: 'b', target: 'dst', target_handle: 'ref' })).ok).toBe(true);
      } else {
        expect((await call('nodes.system.link', { source: 't2', target: 'dst', kind: 'data', target_handle: 'prompt' })).ok).toBe(true);
        expect((await call('nodes.system.link', { source: 'b', target: 'dst', kind: 'data', target_handle: 'ref' })).ok).toBe(true);
      }

      // Single-cable tombstone repaired; multi-cable tombstone preserved
      expect(graph().broken?.map((b) => b.edge.id)).toEqual(['e_ref']);
    },
  );
});

describe('7. missing system endpoint via linkSystemNodes and nodes.system.link', () => {
  it('linkSystemNodes materializes system nodes and connects when sys_chat is missing and the link is valid', () => {
    install({ nodes: [imgNode('img')], edges: [] });
    expect(graph().nodes.map((n) => n.id)).toEqual(['img']);

    const res = linkSystemNodes(sid, {
      source: 'sys_chat',
      target: 'img',
      kind: 'data',
      targetHandle: 'prompt',
      replaces: null,
    });
    expect(res.error).toBeNull();
    expect(graph().nodes.some((n) => n.id === 'sys_chat')).toBe(true);
    expect(graph().edges.some((e) => e.source === 'sys_chat' && e.target === 'img' && e.targetHandle === 'prompt')).toBe(true);
  });

  it('nodes.system.link command rejects unmaterialized sys_chat via hasTarget without mutating, and links creative nodes without materializing', async () => {
    install({ nodes: [imgNode('img'), vidNode('vid')], edges: [] });
    const snap = structuredClone(graph());

    const missing = await call('nodes.system.link', {
      source: 'sys_chat',
      target: 'img',
      kind: 'data',
      target_handle: 'prompt',
    });
    expect(missing.ok).toBe(false);
    expect(graph()).toEqual(snap);

    const creative = await call('nodes.system.link', {
      source: 'img',
      target: 'vid',
      kind: 'ref',
      source_handle: 'out_ref',
      target_handle: 'sys_ref',
    });
    expect(creative.ok).toBe(true);
    expect(graph().nodes.map((n) => n.id)).toEqual(['img', 'vid']);
  });

  it('linkSystemNodes does not materialize system nodes for unknown endpoints or port/class errors', () => {
    install({ nodes: [imgNode('img')], edges: [] });
    const snap = structuredClone(graph());

    expect(linkSystemNodes(sid, { source: 'sys_nonexistent', target: 'img', kind: 'data', targetHandle: 'prompt', replaces: null }).error).not.toBeNull();
    expect(graph()).toEqual(snap);

    expect(linkSystemNodes(sid, { source: 'sys_chat', target: 'img', kind: 'data', targetHandle: 'ref', replaces: null }).error).not.toBeNull();
    expect(graph()).toEqual(snap);

    expect(linkSystemNodes(sid, { source: 'sys_chat', target: 'img', kind: 'data', targetHandle: 'prompt', both: true, replaces: null }).error).not.toBeNull();
    expect(graph()).toEqual(snap);
  });

  it('linkSystemNodes does not leak materialized system nodes when applyEdit rejects a missing-endpoint link due to replaces conflict', () => {
    install({
      nodes: [textNode('t1', 'existing'), imgNode('img')],
      edges: [{ id: 'e_existing', source: 't1', target: 'img', sourceHandle: 'out', targetHandle: 'prompt' }],
    });
    const snap = structuredClone(graph());

    // img.prompt is already occupied by e_existing; blind link (replaces: null) from unmaterialized sys_chat must fail with zero mutation
    const blind = linkSystemNodes(sid, {
      source: 'sys_chat',
      target: 'img',
      kind: 'data',
      targetHandle: 'prompt',
      replaces: null,
    });
    expect(blind.error).not.toBeNull();
    expect(graph()).toEqual(snap);
  });
});
