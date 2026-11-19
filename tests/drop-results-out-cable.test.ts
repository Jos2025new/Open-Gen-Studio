import { describe, expect, it } from 'vitest';
import { dropResults } from '../src/engine/flow/dropResults';
import { NO_RESULT } from '../src/engine/flow/graph';
import { createSession } from '../src/store/store';
import type { Generation, GraphNode, Session } from '../src/engine/types';

const gen = (ids: string[]): Generation => ({ id: 'g1', sessionId: 's', origin: 'node', kind: 'image', modelName: 'm', provider: 'local', prompt: 'p', modelRef: 'local::studio-image', settings: { count: ids.length, advanced: {} }, inputs: { refs: [] }, status: 'done', assetIds: ids, estimate: { usd: 0, approximate: false }, createdAt: 1 });
const node = (id: string, extra: object = {}): GraphNode => ({ id, position: { x: 0, y: 0 }, data: { kind: 'image', title: id, prompt: 'p', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, ...extra } as never });
const world = (pick?: number) => ({
  generations: { g1: gen(['a0', 'a1']) },
  sessions: { s: { ...createSession('s'), id: 's', graph: { nodes: [node('img1', { generationId: 'g1', ...(pick == null ? {} : { outputIndex: pick }) }), node('img2')], edges: [{ id: 'e', source: 'img1', target: 'img2', sourceHandle: 'out', targetHandle: 'ref', kind: 'data' }] } } as Session },
});

describe('deleting the result a plain out cable delivers', () => {
  for (const pick of [undefined, 0]) {
    it(`marks the cable NO_RESULT instead of letting it pick the neighbour (pick ${pick})`, () => {
      const { sessions } = dropResults(world(pick), new Set(['a0']));
      expect(sessions.s.graph.edges[0].outputIndex).toBe(NO_RESULT);
    });
  }
  it('keeps the cable when another result goes', () => {
    const { sessions } = dropResults(world(0), new Set(['a1']));
    expect(sessions.s.graph.edges[0].outputIndex).toBeUndefined();
  });
});
