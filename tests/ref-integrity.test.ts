import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Reference integrity: a missing target is invalid and visible, never replaced by the active doc/session. */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { ensureSystemNodes } from '../src/engine/nodes/system';
import { resolveSystemNodeLive } from '../src/engine/nodes/spec';
import { deleteDoc, ensureDoc } from '../src/engine/design/actions';
import { createSession, useStore } from '../src/store/store';
import type { GraphNode } from '../src/engine/types';

let sid = '';
const nodes = () => useStore.getState().sessions[sid].graph.nodes;
const docNode = (ref: string): GraphNode => ({ id: 'x', position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'designer.doc', ref, title: 'Doc' } });

beforeEach(() => {
  const session = createSession('Refs');
  sid = session.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: session } }));
});

describe('reference integrity', () => {
  it('a doc node whose doc is gone is invalid, not the active doc', () => {
    const live = resolveSystemNodeLive(sid, docNode('missing-doc'))!;
    expect(live.invalid).toBeTruthy();
    expect(live.doc).toBeUndefined();
  });
  it("'active' follows the current doc and says so; a concrete id is pinned", () => {
    const doc = ensureDoc(sid);
    expect(resolveSystemNodeLive(sid, docNode('active'))).toMatchObject({ tracking: 'following' });
    expect(resolveSystemNodeLive(sid, docNode(doc.id))).toMatchObject({ tracking: 'pinned', ref: doc.id });
  });
  it('deleteDoc leaves the nodes that pointed to it visibly invalid', () => {
    const doc = ensureDoc(sid);
    ensureSystemNodes(sid);
    const node = nodes().find((n) => n.data.kind === 'ref' && n.data.type === 'designer.doc' && n.data.ref === doc.id)!;
    expect(resolveSystemNodeLive(sid, node)!.invalid).toBeUndefined();
    deleteDoc(sid, doc.id);
    expect(resolveSystemNodeLive(sid, node)!.invalid).toBeTruthy();
  });
  it('a chat, agent or session node of a deleted session is invalid', () => {
    for (const type of ['chat', 'agent', 'session'] as const) {
      const n: GraphNode = { id: type, position: { x: 0, y: 0 }, data: { kind: 'ref', type, ref: 'gone', title: type } };
      expect(resolveSystemNodeLive(sid, n)!.invalid).toBeTruthy();
    }
  });
});

describe('model references', () => {
  it('a model whose provider has other models loaded but not this one is invalid', () => {
    useStore.setState((st) => ({ catalog: { ...st.catalog, models: { 'atlas::present': { ref: 'atlas::present', provider: 'atlas', id: 'present', name: 'Present', kind: 'image' } as never } } }));
    const n = (ref: string): GraphNode => ({ id: 'm', position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'model', ref, title: 'M' } });
    expect(resolveSystemNodeLive(sid, n('atlas::present'))!.invalid).toBeUndefined();
    expect(resolveSystemNodeLive(sid, n('atlas::renamed'))!.invalid).toBeTruthy();
    expect(resolveSystemNodeLive(sid, n('local::studio-image'))!.invalid).toBeUndefined();
    expect(resolveSystemNodeLive(sid, n(''))!.invalid).toBeUndefined();
  });
});
