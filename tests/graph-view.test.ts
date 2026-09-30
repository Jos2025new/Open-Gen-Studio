import { describe, expect, it, vi } from 'vitest';
import { graphIndex, readGraph, GRAPH_PAGE } from '../src/engine/flow/graphView';
import { nodeSelection, setNodeSelection, useNodeSelection } from '../src/engine/flow/selection';
import { useStore } from '../src/store/store';
import type { Generation, Graph, GraphNode } from '../src/engine/types';

vi.hoisted(() => {
  Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));

const imageNode = (id: string, generationId?: string): GraphNode =>
  ({ id, position: { x: 0, y: 0 }, data: { kind: 'image', title: `Image ${id}`, prompt: `prompt ${id}`, modelRef: 'atlas::m', settings: {}, generationId, outputIndex: 0 } }) as never;

function bigGraph(n: number): { graph: Graph; generations: Record<string, Generation> } {
  const nodes = Array.from({ length: n }, (_, i) => imageNode(`nd${i}`, i % 2 ? undefined : `g${i}`));
  const generations: Record<string, Generation> = {};
  for (let i = 0; i < n; i += 2) generations[`g${i}`] = { id: `g${i}`, status: i === 4 ? 'error' : 'done', error: i === 4 ? 'boom' : undefined, assetIds: [`a${i}`] } as never;
  const edges = [{ id: 'e1', source: 'nd0', target: 'nd1', targetHandle: 'ref', sourceHandle: 'out' }];
  return { graph: { nodes, edges }, generations };
}

describe('node graph views for the agent', () => {
  it('caps the index and always includes selected nodes', () => {
    const { graph, generations } = bigGraph(60);
    const text = graphIndex(graph, generations, ['nd55']);
    const lines = text.split('\n').filter((l) => l.startsWith('  nd'));
    expect(lines).toHaveLength(GRAPH_PAGE);
    expect(text).toContain('nd55 image "Image nd55"');
    expect(text).toContain('(selected)');
    expect(text).toContain('+20 more');
    expect(text).toContain('nd0 image "Image nd0" done → asset:a0 · in 0 · out 1');
  });

  it('asks when nothing is selected', () => {
    const { graph, generations } = bigGraph(3);
    expect(graphIndex(graph, generations, [])).toContain('ask which one');
  });

  it('pages the index and details nodes with their usable asset and ports', () => {
    const { graph, generations } = bigGraph(60);
    const page = readGraph(graph, generations, [], { offset: 40 });
    expect(page).toContain('nodes 41–60 of 60');
    expect(page).not.toContain('next page');
    expect(readGraph(graph, generations, [], {})).toContain('read_graph({offset: 40})');
    const detail = readGraph(graph, generations, ['nd1'], { node_ids: ['nd0', 'nd4', 'nope'] });
    expect(detail).toContain('output: asset:a0 (use it in plans)');
    expect(detail).toContain('feeds: nd1 "Image nd1" (ref, edge:e1)');
    expect(detail).toContain('error: boom');
    expect(detail).toContain('nope: no such node');
  });

  it('selecting nodes never touches the persisted store', () => {
    const before = useStore.getState();
    const calls = vi.fn();
    const unsub = useStore.subscribe(calls);
    setNodeSelection('s', ['b', 'a']);
    const after = useNodeSelection.getState();
    setNodeSelection('s', new Set(['a', 'b']));
    unsub();
    expect(calls).not.toHaveBeenCalled();
    expect(useStore.getState()).toBe(before);
    expect(useNodeSelection.getState()).toBe(after); // same ids: no update
    expect(nodeSelection('s')).toEqual(['a', 'b']);
  });
});
