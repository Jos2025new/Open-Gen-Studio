import { describe, expect, it, vi } from 'vitest';

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
import { addConnected } from '../src/engine/flow/actions';

describe('a node made from another keeps its current model', () => {
  it('inherits the model the source has now (changed A → B gives B), with its settings and no seed', () => {
    const st = useStore.getState();
    const sid = st.activeSessionId;
    const src = { kind: 'image', title: 'X', prompt: 'x', modelRef: 'atlas::B', settings: { count: 1, resolution: '2k', seed: 7, advanced: {} }, outputIndex: 0 };
    useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: { nodes: [{ id: 'x', position: { x: 0, y: 0 }, data: src as never }], edges: [] }, feed: [] } } });
    const fresh = { kind: 'image', title: 'Image', prompt: '', modelRef: 'atlas::A', settings: { count: 1, advanced: {} }, outputIndex: 0 };
    const id = addConnected(sid, 'x', fresh as never)!;
    const made = useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === id)!.data as typeof src;
    expect(made.modelRef).toBe('atlas::B');
    expect(made.settings.resolution).toBe('2k');
    expect(made.settings.seed).toBeUndefined();
  });
});
