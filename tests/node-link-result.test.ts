import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { connect, graphToSteps, handleIndex, planToGraph, resultHandle } from '../src/engine/flow/graph';
import type { Generation, Plan } from '../src/engine/types';

// A24: each link keeps the result it uses, so one step can feed two of its candidates on the Node board.
const settings = { count: 2, advanced: {} };
const plan = { id: 'p', title: 't', workspace: 'node', steps: [
  { id: 's1', kind: 'image', title: 'Face', prompt: 'a face', modelRef: 'fal::img', settings, refs: [] },
  { id: 's2', kind: 'image', title: 'Smile', prompt: 'smiling', modelRef: 'fal::img', settings: { ...settings, count: 1 }, refs: ['s1#1'] },
  { id: 's3', kind: 'image', title: 'Serious', prompt: 'serious', modelRef: 'fal::img', settings: { ...settings, count: 1 }, refs: ['s1#2'] },
] } as unknown as Plan;

describe('Nodes: each link keeps its own result', () => {
  it('two links from one step keep the two different candidates the plan named', () => {
    const { nodes, edges } = planToGraph(plan);
    const id = (step: string) => nodes.find((n) => n.data.title === plan.steps.find((s) => s.id === step)!.title)!.id;
    const all = nodes.map((n) => n.id);
    const run = graphToSteps({ nodes, edges } as never, all, {}, { force: true });
    const refs = (step: string) => (run.steps.find((s) => s.id === id(step)) as { refs: string[] }).refs;
    expect(refs('s2')).toEqual([id('s1')]);
    expect(refs('s3')).toEqual([`${id('s1')}#2`]);
  });

  it('a finished source gives each link its own asset; an old link without an index uses the node pick', () => {
    const { nodes, edges } = planToGraph(plan);
    const src = nodes.find((n) => n.data.title === 'Face')!;
    (src.data as { generationId?: string }).generationId = 'g1';
    const gens = { g1: { id: 'g1', status: 'done', assetIds: ['a1', 'a2'] } as unknown as Generation };
    const targets = nodes.filter((n) => n.id !== src.id).map((n) => n.id);
    const byTitle = (t: string) => (graphToSteps({ nodes, edges } as never, targets, gens, { force: true }).steps.find((s) => s.title === t) as { refs: string[] }).refs;
    expect(byTitle('Smile')).toEqual(['asset:a1']);
    expect(byTitle('Serious')).toEqual(['asset:a2']);
    const old = edges.map(({ outputIndex: _drop, ...e }) => e);
    expect((graphToSteps({ nodes, edges: old } as never, targets, gens, { force: true }).steps.find((s) => s.title === 'Serious') as { refs: string[] }).refs).toEqual([`asset:a${(src.data as { outputIndex: number }).outputIndex + 1}`]);
  });
});

describe('Nodes: one output port per result', () => {
  it('a link dragged from port 2 keeps the second result; from + it follows the node pick', () => {
    const { nodes, edges } = planToGraph(plan);
    const [a, b] = [nodes[0].id, nodes[1].id];
    const fixed = connect({ nodes, edges: [] } as never, { source: a, target: b, targetHandle: 'ref', sourceHandle: 'out-2' }).edges[0];
    expect(fixed).toMatchObject({ sourceHandle: 'out-2', outputIndex: 1 });
    const free = connect({ nodes, edges: [] } as never, { source: a, target: b, targetHandle: 'ref', sourceHandle: 'out' }).edges[0];
    expect(free.sourceHandle).toBe('out');
    expect(free.outputIndex).toBeUndefined();
    expect([handleIndex('out-3'), handleIndex('out'), resultHandle(0)]).toEqual([2, undefined, 'out-1']);
  });
  it('a plan link that names #1 is fixed to the first result and leaves from its port', () => {
    const { edges } = planToGraph(plan);
    expect(edges.map((e) => [e.sourceHandle, e.outputIndex])).toEqual([['out-1', 0], ['out-2', 1]]);
  });
});
