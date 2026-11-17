import { describe, expect, it } from 'vitest';
import { nodeIsCurrent, nodeRequest, stable } from '../src/engine/flow/freshness';
import type { Asset, Generation, Graph, GraphNode } from '../src/engine/types';

/* freshness sees ref/control links and the content revision of what they point to. */
const gen = { id: 'g1', status: 'done', assetIds: ['out'], prompt: 'p', settings: { count: 1 }, inputs: { refs: [] } } as unknown as Generation;
const node = { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'tool', title: 't', op: 'relight', params: {}, generationId: 'g1', outputIndex: 0 } } as unknown as GraphNode;
const asset = { id: 'a1', kind: 'image', mime: 'image/png', width: 1, height: 1, createdAt: 0 } as unknown as Asset;
const src = { id: 'src', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'a', assetId: 'a1', outputIndex: 0 } } as unknown as GraphNode;
const graph = (withRef: boolean): Graph => ({ nodes: [node, src], edges: withRef ? [{ id: 'e', source: 'src', target: 'n1', kind: 'ref' }] : [], groups: [] } as unknown as Graph);

describe('freshness with ref/control links', () => {
  const saved = (g: Graph, assets: Record<string, Asset>) => ({ ...gen, nodeRequest: stable(nodeRequest(g, node, { g1: gen }, [], { assets })) }) as Generation;
  it('a new ref link makes the result stale', () => {
    const before = saved(graph(false), { a1: asset });
    expect(nodeIsCurrent(graph(false), node, { g1: before }, [], { assets: { a1: asset } })).toBe(true);
    expect(nodeIsCurrent(graph(true), node, { g1: before }, [], { assets: { a1: asset } })).toBe(false);
  });
  it('editing the referred asset (new revision) makes the result stale', () => {
    const g = graph(true);
    const before = saved(g, { a1: asset });
    expect(nodeIsCurrent(g, node, { g1: before }, [], { assets: { a1: asset } })).toBe(true);
    const edited = { ...asset, revisions: [{ assetId: 'a0' }, { assetId: 'a1' }], revisionIndex: 1 } as unknown as Asset;
    expect(nodeIsCurrent(g, node, { g1: before }, [], { assets: { a1: edited } })).toBe(false);
  });
});

describe('control links', () => {
  it('a new control link makes the result stale, like a ref link', () => {
    const base = { nodes: [node, src], edges: [] as never[], groups: [] } as unknown as Graph;
    const withControl = { ...base, edges: [{ id: 'c', source: 'src', target: 'n1', kind: 'control' }] } as unknown as Graph;
    const g1 = { ...gen, nodeRequest: stable(nodeRequest(base, node, { g1: gen }, [], { assets: { a1: asset } })) } as Generation;
    expect(nodeIsCurrent(base, node, { g1 }, [], { assets: { a1: asset } })).toBe(true);
    expect(nodeIsCurrent(withControl, node, { g1 }, [], { assets: { a1: asset } })).toBe(false);
  });
});
