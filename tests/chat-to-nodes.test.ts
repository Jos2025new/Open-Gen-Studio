import { describe, expect, it, vi } from 'vitest';
import type { Asset, Generation } from '../src/engine/types';

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
import { chatToNodes, chatWorkNotInNodes } from '../src/engine/flow/fromChat';
import { nodeIsCurrent } from '../src/engine/flow/freshness';

const asset = (id: string, kind: Asset['kind'], generationId?: string): Asset =>
  ({ id, kind, name: id, mime: kind === 'video' ? 'video/mp4' : 'image/png', width: 832, height: 1248, createdAt: 1, origin: generationId ? 'generation' : 'upload', ...(generationId ? { generationId } : {}) }) as unknown as Asset;
const gen = (id: string, sid: string, extra: Partial<Generation>): Generation =>
  ({ id, sessionId: sid, kind: 'image', prompt: 'a heroine', modelRef: 'atlas::nb', modelName: 'NB', provider: 'atlas', settings: { count: 4, aspect: '3:2', seed: 7, advanced: {} }, inputs: { refs: [] }, origin: 'agent', status: 'done', assetIds: [], estimate: { usd: 0 }, createdAt: 1, ...extra }) as unknown as Generation;

describe('chat work → node canvas', () => {
  it('rebuilds generations as connected nodes that count as up to date, and only once', () => {
    const st = useStore.getState();
    const sid = st.activeSessionId;
    const sheet = gen('g1', sid, { assetIds: ['a1', 'a2', 'a3', 'a4'], createdAt: 1 });
    // The user picked the 2nd sheet: an edit of it, then a clip from the upload with the edit as reference.
    const edit = gen('g2', sid, { prompt: 'younger face', op: { id: 'edit', params: { instruction: 'younger face' }, sourceAssetId: 'a2' }, assetIds: ['a5'], createdAt: 2 });
    const clip = gen('g3', sid, { kind: 'video', prompt: 'she turns', settings: { count: 1, duration: 5, advanced: {} }, inputs: { refs: ['a5'], firstFrame: 'up1' }, assetIds: ['v1'], createdAt: 3 });
    useStore.setState({
      generations: { ...st.generations, g1: sheet, g2: edit, g3: clip },
      assets: { ...st.assets, ...Object.fromEntries([['a1', 'g1'], ['a2', 'g1'], ['a3', 'g1'], ['a4', 'g1'], ['a5', 'g2']].map(([a, g]) => [a, asset(a, 'image', g)])), v1: asset('v1', 'video', 'g3'), up1: asset('up1', 'image') },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { nodes: [], edges: [] }, feed: [1, 2, 3].map((n) => ({ id: `f${n}`, createdAt: n, workspace: 'chat', type: 'generation', generationId: `g${n}` })) as never } },
    });

    expect(chatWorkNotInNodes(sid)).toHaveLength(3);
    const { added, edges } = chatToNodes(sid);
    const graph = useStore.getState().sessions[sid].graph;
    const s = useStore.getState();
    const of = (g: string) => graph.nodes.find((n) => 'generationId' in n.data && n.data.generationId === g)!;
    expect(added).toHaveLength(4); // three generations + the upload
    // The sheet node shows the picked 2nd result, which feeds the edit; the edit feeds the clip as a reference.
    expect(of('g1').data).toMatchObject({ outputIndex: 1 });
    expect(edges.map((e) => [graph.nodes.find((n) => n.id === e.source)!.data.kind, e.targetHandle]).sort()).toEqual([['asset', 'first'], ['image', 'input'], ['tool', 'ref']]);
    // Up to date: nothing would run again.
    for (const g of ['g1', 'g2', 'g3']) expect(nodeIsCurrent(graph, of(g), s.generations, s.library)).toBe(true);
    // A second time adds nothing.
    expect(chatWorkNotInNodes(sid)).toHaveLength(0);
    expect(chatToNodes(sid).added).toHaveLength(0);
  });
});

describe('duplicate a node', () => {
  it('keeps params and connections (inputs; outputs only into multi-input ports), not the result, and says it is a copy', async () => {
    const { duplicateNode } = await import('../src/engine/flow/actions');
    const st = useStore.getState();
    const sid = st.activeSessionId;
    const img = { kind: 'image', title: 'Image', prompt: 'back view', modelRef: 'atlas::nb', settings: { count: 1, advanced: {} }, outputIndex: 0 };
    useStore.setState({
      assets: { ...st.assets, up: asset('up', 'image') },
      generations: { ...st.generations, gX: gen('gX', sid, { status: 'running' as never }) },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: {
        nodes: [
          { id: 'src', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Asset', assetId: 'up' } },
          { id: 'n', position: { x: 300, y: 0 }, data: { ...img, generationId: 'gX' } },
          { id: 'v', position: { x: 600, y: 0 }, data: { ...img, kind: 'video', title: 'Video' } },
        ],
        edges: [
          { id: 'e1', source: 'src', target: 'n', sourceHandle: 'out', targetHandle: 'ref' },
          { id: 'e2', source: 'n', target: 'v', sourceHandle: 'out', targetHandle: 'first' },
          { id: 'e3', source: 'n', target: 'v', sourceHandle: 'out', targetHandle: 'ref' },
        ],
      } } as never },
    });
    const node = useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === 'n')!;
    const id = duplicateNode(sid, node);
    const g = useStore.getState().sessions[sid].graph;
    const copy = g.nodes.find((n) => n.id === id)!;
    expect(copy.data).toMatchObject({ title: 'Image (copy)', prompt: 'back view' });
    expect('generationId' in copy.data && copy.data.generationId).toBeFalsy();
    expect(g.edges.filter((e) => e.target === id).map((e) => [e.source, e.targetHandle])).toEqual([['src', 'ref']]);
    // "first" takes one input and keeps the original; "ref" takes several, so the copy joins it.
    expect(g.edges.filter((e) => e.source === id).map((e) => e.targetHandle)).toEqual(['ref']);
    expect(g.edges.find((e) => e.id === 'e2')).toBeTruthy();
  });
});
