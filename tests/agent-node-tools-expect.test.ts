import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(()=>Object.assign(globalThis,{window:{setTimeout,clearTimeout,addEventListener(){}},document:{addEventListener(){},visibilityState:'visible'}}));
vi.mock('../src/lib/idb',()=>({stateDb:{get:async()=>undefined,set:async()=>undefined},cacheDb:{get:async()=>undefined,set:async()=>undefined},getAssetBlob:async()=>undefined,putAssetBlob:async()=>undefined}));
import { useStore } from '../src/store/store';
import { editGraphTool } from '../src/engine/agent/nodeTools';
import { readGraph } from '../src/engine/flow/graphView';
import { ownerRev } from '../src/engine/nodecore/revision';
import { patchNodeData } from '../src/engine/flow/actions';
import type { Graph } from '../src/engine/types';

/** The agent's edit tools do not run blind (ADR 0031): edit_node names the revision it read, connect_nodes the cable it replaces. */
let sid: string;
const text = (id: string, t: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'text' as const, title: t, text: 'old' } });
const prompt = (id: string) => ({ id, position: { x: 300, y: 0 }, data: { kind: 'image' as const, title: id, prompt: 'p', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, outputIndex: 0 } });
const S = () => useStore.getState().sessions[sid];
beforeEach(() => {
  const st = useStore.getState(); sid = st.activeSessionId;
  const graph: Graph = { nodes: [text('t1', 'one'), text('t2', 'two'), prompt('img')], edges: [{ id: 'e1', source: 't1', target: 'img', sourceHandle: 'out', targetHandle: 'prompt', kind: 'data' }] };
  useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph, feed: [] } } });
});

describe('agent node tools', () => {
  it('read_graph shows the revision of each node it details', () => {
    expect(readGraph(S().graph, {}, [], { node_ids: ['t1'] })).toContain(`rev: ${ownerRev(S().graph, 't1')}`);
  });
  it('edit_node without the revision it read is refused and changes nothing', async () => {
    const r = await editGraphTool(sid, 'edit_node', { node_id: 't1', prompt: 'new' });
    expect(r.text).toMatch(/expect_rev/);
    expect(S().graph.nodes.find((n) => n.id === 't1')!.data).toMatchObject({ text: 'old' });
  });
  it('edit_node with a stale revision is refused; with the current one it works', async () => {
    const stale = ownerRev(S().graph, 't1')!;
    patchNodeData(sid, 't1', { text: 'someone else' } as never);
    expect((await editGraphTool(sid, 'edit_node', { node_id: 't1', prompt: 'mine', expect_rev: stale })).text).toMatch(/changed since/);
    expect(S().graph.nodes.find((n) => n.id === 't1')!.data).toMatchObject({ text: 'someone else' });
    const ok = await editGraphTool(sid, 'edit_node', { node_id: 't1', prompt: 'mine', expect_rev: ownerRev(S().graph, 't1')! });
    expect(ok.text).toContain('Updated');
    expect(S().graph.nodes.find((n) => n.id === 't1')!.data).toMatchObject({ text: 'mine' });
  });
  it('connect_nodes over an occupied port needs the cable it replaces', async () => {
    const blind = await editGraphTool(sid, 'connect_nodes', { source: 't2', target: 'img', port: 'prompt' });
    expect(blind.text).toMatch(/already has a cable/);
    expect(S().graph.edges.map((e) => e.id)).toEqual(['e1']);
    const named = await editGraphTool(sid, 'connect_nodes', { source: 't2', target: 'img', port: 'prompt', replaces: 'e1' });
    expect(named.text).toContain('Connected');
    expect(S().graph.edges.map((e) => e.source)).toEqual(['t2']);
  });
});
