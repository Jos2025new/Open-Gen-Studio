import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
import { GONE_HANDLE, NO_RESULT, graphToSteps } from '../src/engine/flow/graph';
import type { Generation, Graph } from '../src/engine/types';

/*
 * 2026-10-29 audit: a link marked «no output» (its image was deleted) must stay without one even when its source runs in
 * the same batch (Run all). It must never become `${source}#0` / the first image.
 */
const settings = { count: 3, advanced: {} };
const node = (id: string, title: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: 'image' as const, title, prompt: title, modelRef: 'fal::img', settings, outputIndex: 0 } });
const graph: Graph = {
  nodes: [node('face', 'Face'), node('smile', 'Smile')],
  edges: [{ id: 'e', source: 'face', target: 'smile', sourceHandle: GONE_HANDLE, targetHandle: 'ref', outputIndex: NO_RESULT }],
};
const gens = { g1: { id: 'g1', status: 'done', assetIds: ['a1', 'a2'] } as unknown as Generation };

describe('a «no output» link in a joint run', () => {
  for (const [label, g] of [['source also runs', {}], ['source finished before', gens]] as const) {
    it(`delivers no image and reports it (${label})`, () => {
      const graphWith = g === gens ? { ...graph, nodes: [{ ...graph.nodes[0], data: { ...graph.nodes[0].data, generationId: 'g1' } }, graph.nodes[1]] } : graph;
      const targets = g === gens ? ['smile'] : ['face', 'smile'];
      const r = graphToSteps(graphWith as never, targets, g as never, { force: true, assets: {} });
      const smile = r.steps.find((s) => s.id === 'smile') as { refs?: string[] } | undefined;
      expect(smile?.refs ?? []).toEqual([]);
      expect(r.errors.join(' ')).toMatch(/no output/i);
    });
  }
});
