import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
  deleteAssetBlobs: async () => undefined,
}));
import { useStore } from '../src/store/store';
import { deleteAssets } from '../src/engine/actions';
import { duplicateNode } from '../src/engine/flow/actions';
import { copyNodes, pasteNodes } from '../src/engine/flow/arrange';
import { graphToSteps, planToGraph } from '../src/engine/flow/graph';
import type { Generation, Plan } from '../src/engine/types';

// Repro (case 1): a downstream link must keep delivering the SAME image after delete / duplicate / paste.
// Source "Face" has 3 results a1..a3; the link to "Smile" is fixed to result 3 (a3) via edge.outputIndex.
const settings = { count: 3, advanced: {} };
const plan = { id: 'p', title: 't', workspace: 'node', steps: [
  { id: 's1', kind: 'image', title: 'Face', prompt: 'a face', modelRef: 'fal::img', settings, refs: [] },
  { id: 's2', kind: 'image', title: 'Smile', prompt: 'smiling', modelRef: 'fal::img', settings: { ...settings, count: 1 }, refs: ['s1#3'] },
] } as unknown as Plan;
const gens = (ids: string[]) => ({ g1: { id: 'g1', status: 'done', assetIds: ids } as unknown as Generation });
const asset = (id: string) => ({ id, kind: 'image', name: id, createdAt: 0 });

let sid: string, face: string, smile: string;
function setup(pick = 0) {
  const st = useStore.getState();
  sid = st.activeSessionId;
  const { nodes, edges } = planToGraph(plan);
  face = nodes.find((n) => n.data.title === 'Face')!.id;
  smile = nodes.find((n) => n.data.title === 'Smile')!.id;
  Object.assign(nodes.find((n) => n.id === face)!.data, { generationId: 'g1', outputIndex: pick });
  useStore.setState({
    assets: Object.fromEntries(['a1', 'a2', 'a3'].map((a) => [a, asset(a)])) as never,
    generations: gens(['a1', 'a2', 'a3']),
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { nodes, edges } as never, feed: [] } },
  });
}
const graph = () => useStore.getState().sessions[sid].graph;
/** What the step for node `target` would receive as its reference image. */
function refsOf(target: string): string[] {
  const g = graph(), s = useStore.getState();
  const step = graphToSteps(g as never, [target], s.generations, { force: true, assets: s.assets }).steps.find((x) => x.id === target) as { refs: string[] };
  return step.refs;
}

describe('repro 1: a link keeps its image (nodes.md 3.5 / 3.6)', () => {
  beforeEach(() => setup());

  it('baseline: the link to Smile delivers a3', () => {
    expect(refsOf(smile)).toEqual(['asset:a3']);
  });

  // Cause: engine/actions.ts:556 filters g.assetIds without remapping data.outputIndex / edge.outputIndex.
  it('deleting result 1 of 3 leaves the link on the same image (a3)', () => {
    deleteAssets(['a1']);
    expect(refsOf(smile)).toEqual(['asset:a3']);
  });

  // Cause: same line; link on result 2 (a2) silently moves to a3 (wrong image, no warning).
  it('deleting result 1 leaves a link fixed on a2 delivering a2, not a3', () => {
    const g = graph();
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { ...g, edges: g.edges.map((e) => ({ ...e, outputIndex: 1, sourceHandle: 'out-2' })) } as never } } }));
    expect(refsOf(smile)).toEqual(['asset:a2']);
    deleteAssets(['a1']);
    expect(refsOf(smile)).toEqual(['asset:a2']);
  });

  // Cause: same line; the node pick (outputIndex 1 = a2) also shifts onto a3 once a1 is gone.
  it('deleting result 1 keeps the node pick on a2 (the image the node showed)', () => {
    setup(1);
    deleteAssets(['a1']);
    const s = useStore.getState();
    const n = graph().nodes.find((x) => x.id === face)!;
    const d = n.data as { generationId: string; outputIndex: number };
    expect(s.generations[d.generationId].assetIds[d.outputIndex]).toBe('a2');
  });

  // Cause: flow/actions.ts:151 copies the input edge without sourceHandle, so connect() (graph.ts:143) drops outputIndex.
  it('a duplicated node keeps receiving a3 from the fixed link', () => {
    const copy = duplicateNode(sid, graph().nodes.find((n) => n.id === smile)!);
    expect(refsOf(copy)).toEqual(['asset:a3']);
  });

  // Cause: arrange.ts:172 rebuilds the link to a node still on the canvas without sourceHandle/outputIndex.
  it('a pasted node keeps receiving a3 from the fixed link', () => {
    copyNodes(sid, [smile]);
    const [pasted] = pasteNodes(sid);
    expect(refsOf(pasted)).toEqual(['asset:a3']);
  });

  // Audit 2026-10-29: deleting the image a link was fixed on left outputIndex past the last result; once the node held
  // enough results again that index was valid and the link silently delivered a NEW image.
  it('a link whose image was deleted does not deliver a new image when the node regenerates', () => {
    deleteAssets(['a3']);
    expect(refsOf(smile)).toEqual([]);
    useStore.setState((st) => ({
      assets: { ...st.assets, ...Object.fromEntries(['b1', 'b2', 'b3'].map((a) => [a, asset(a)])) } as never,
      generations: { g1: { ...st.generations.g1, assetIds: ['b1', 'b2', 'b3'] } },
    }));
    expect(refsOf(smile)).toEqual([]);
  });

  it('the input thumbnail of that link shows no output, before and after regeneration', async () => {
    const { nodeOutputAsset } = await import('../src/engine/flow/graph');
    const edge = () => graph().edges.find((e) => e.target === smile)!;
    const src = () => graph().nodes.find((n) => n.id === face)!;
    deleteAssets(['a3']);
    expect(nodeOutputAsset(src() as never, useStore.getState().generations, edge().outputIndex)).toBeNull();
    useStore.setState((st) => ({ generations: { g1: { ...st.generations.g1, assetIds: ['b1', 'b2', 'b3'] } } }));
    expect(nodeOutputAsset(src() as never, useStore.getState().generations, edge().outputIndex)).toBeNull();
  });

  it('a duplicated node keeps the no-output state of a link whose image was deleted', () => {
    deleteAssets(['a3']);
    const copy = duplicateNode(sid, graph().nodes.find((n) => n.id === smile)!);
    expect(refsOf(copy)).toEqual([]);
  });
});
