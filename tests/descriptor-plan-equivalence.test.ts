import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { graphToSteps } from '../src/engine/flow/graph';
import type { Graph, GraphNode } from '../src/engine/types';

/* Golden equivalence: the steps, runIds and errors graphToSteps gave before each descriptor built its own step
 * (tests/fixtures/descriptor-plan.golden.json was recorded from the code before the move). */
const node = (id: string, data: Record<string, unknown>): GraphNode => ({ id, position: { x: 0, y: 0 }, data: { title: id, ...data } as never });
const edge = (s: string, t: string, h: string, extra: Record<string, unknown> = {}) => ({ id: `${s}-${t}-${h}`, source: s, target: t, sourceHandle: 'out', targetHandle: h, ...extra });
const g = (nodes: GraphNode[], edges: ReturnType<typeof edge>[]): Graph => ({ nodes, edges } as unknown as Graph);

const cases: Record<string, { graph: Graph; targets: string[] }> = {
  image: {
    graph: g([node('t', { kind: 'text', text: 'a cat' }), node('as', { kind: 'asset', assetId: 'A1' }), node('i', { kind: 'image', prompt: 'own', modelRef: 'm', settings: { n: 2 }, outputIndex: 0 })],
      [edge('t', 'i', 'prompt'), edge('as', 'i', 'ref')]),
    targets: ['i'],
  },
  imageNoPrompt: { graph: g([node('i', { kind: 'image', prompt: ' ', outputIndex: 0 }), node('m', { kind: 'model3d', prompt: '', outputIndex: 0 })], []), targets: ['i', 'm'] },
  chain: {
    graph: g([node('i1', { kind: 'image', prompt: 'one', outputIndex: 0 }), node('i2', { kind: 'image', prompt: 'two', outputIndex: 0 }), node('m', { kind: 'model3d', prompt: 'solid', outputIndex: 0 })],
      [edge('i1', 'i2', 'ref'), edge('i2', 'm', 'ref')]),
    targets: ['m'],
  },
  video: {
    graph: g([node('f', { kind: 'asset', assetId: 'F' }), node('l', { kind: 'asset', assetId: 'L' }), node('r', { kind: 'asset', assetId: 'R' }), node('rv', { kind: 'asset', assetId: 'RV' }), node('au', { kind: 'asset', assetId: 'AU' }), node('t', { kind: 'text', text: 'pan' }),
      node('v', { kind: 'video', prompt: '', modelRef: 'vm', settings: {}, outputIndex: 0 })],
      [edge('f', 'v', 'first'), edge('l', 'v', 'last'), edge('r', 'v', 'ref'), edge('rv', 'v', 'refVideo'), edge('au', 'v', 'audio'), edge('t', 'v', 'prompt')]),
    targets: ['v'],
  },
  videoNeedsPrompt: { graph: g([node('v', { kind: 'video', prompt: '', outputIndex: 0 })], []), targets: ['v'] },
  audio: {
    graph: g([node('t', { kind: 'text', text: 'sing' }), node('ly', { kind: 'text', text: 'la la' }), node('a', { kind: 'audio', prompt: 'p', outputIndex: 0, textOutput: true }), node('a2', { kind: 'audio', prompt: '', outputIndex: 0 })],
      [edge('t', 'a', 'prompt'), edge('ly', 'a', 'lyrics'), edge('a', 'a2', 'lyrics')]),
    targets: ['a2'],
  },
  tool: {
    graph: g([node('as', { kind: 'asset', assetId: 'A1' }), node('i', { kind: 'image', prompt: 'x', outputIndex: 0 }), node('tl', { kind: 'tool', op: 'upscale', params: { scale: 2 }, outputIndex: 0 }), node('tl2', { kind: 'tool', op: 'upscale', params: {}, outputIndex: 0 })],
      [edge('i', 'tl', 'input'), edge('as', 'tl2', 'input')]),
    targets: ['tl', 'tl2'],
  },
  toolNoInput: { graph: g([node('tl', { kind: 'tool', op: 'upscale', params: {}, outputIndex: 0 })], []), targets: ['tl'] },
  subjects: {
    graph: g([node('i1', { kind: 'image', prompt: 'face', outputIndex: 0 }), node('i2', { kind: 'image', prompt: 'scene', outputIndex: 0, subjects: [{ id: 's', name: 'S', from: 'i1' }] })], []),
    targets: ['i2'],
  },
};

const run = () => Object.fromEntries(Object.entries(cases).map(([k, c]) => [k, graphToSteps(c.graph, c.targets, {}, { assets: { A1: { id: 'A1', kind: 'image' }, F: { id: 'F', kind: 'image' }, L: { id: 'L', kind: 'image' }, R: { id: 'R', kind: 'image' }, RV: { id: 'RV', kind: 'video' }, AU: { id: 'AU', kind: 'audio' } } as never } as never)]));
const GOLDEN = 'tests/fixtures/descriptor-plan.golden.json';

describe('plans built by the descriptors equal the former graphToSteps chain', () => {
  it('steps, runIds and errors are identical for every kind', () => {
    const now = JSON.parse(JSON.stringify(run()));
    if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
    expect(now).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
    expect(Object.keys(now)).toEqual(Object.keys(cases));
  });
});
