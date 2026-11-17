import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { runNodes } from '../src/engine/flow/actions';
import { createSession, useStore } from '../src/store/store';
import type { GraphNode } from '../src/engine/types';
const calls = vi.hoisted(() => [] as string[]);
vi.mock('../src/engine/jobs', async importOriginal => { const actual = await importOriginal<typeof import('../src/engine/jobs')>(); return {
  ...actual,
  createGeneration: () => ({ id: 'provider-spy-generation' }),
  runGeneration: async () => { calls.push('runGeneration'); throw new Error('provider spy intercepted before network'); },
}; });

let sid = '';
beforeEach(() => {
  calls.length = 0; const s = createSession('Required fields'); sid = s.id; const st = useStore.getState();
  const tool: GraphNode = { id: 'tool', position: { x: 0, y: 0 }, data: { kind: 'tool', title: 'Edit', op: 'edit', params: { instruction: '' } } as never };
  const source: GraphNode = { id: 'source', position: { x: -100, y: 0 }, data: { kind: 'asset', title: 'Source', assetId: 'img' } as never };
  useStore.setState({ activeSessionId: sid, sessions: { ...st.sessions, [sid]: { ...s, graph: { ...s.graph, nodes: [source, tool], edges: [{ id: 'input', source: 'source', target: 'tool', sourceHandle: 'out', targetHandle: 'input', kind: 'data' }] } } }, assets: { img: { id: 'img', kind: 'image', mime: 'image/png', width: 1, height: 1, createdAt: 0 } as never } });
});

describe('required operation fields', () => {
  it('an empty required instruction is rejected before createGeneration/provider work', async () => {
    await runNodes(sid, ['tool']);
    expect(calls).toEqual([]);
  });
});
