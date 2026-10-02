import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));

import { useStore } from '../src/store/store';
import { generationPlace } from '../src/engine/goTo';
import type { Generation } from '../src/engine/types';

const gen = (id: string, sid: string, origin: string, assetIds: string[]) => ({ id, sessionId: sid, origin, kind: 'image', assetIds, status: 'done', inputs: { refs: [] } }) as unknown as Generation;

describe('Generations → go to where it was made', () => {
  it('finds the chat card, the node, or the Designer layer', () => {
    const st = useStore.getState();
    const sid = st.activeSessionId;
    const gChat = gen('gc', sid, 'composer', ['a1']);
    const gNode = gen('gn', sid, 'node', ['a2']);
    const gDes = gen('gd', sid, 'designer', ['a3']);
    useStore.setState({
      generations: { gc: gChat, gn: gNode, gd: gDes },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], title: 'S', feed: [{ id: 'f1', createdAt: 1, workspace: 'chat', type: 'generation', generationId: 'gc' }], graph: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'I', prompt: '', modelRef: 'x', settings: { count: 1, advanced: {} }, outputIndex: 0, generationId: 'gn' } }], edges: [] }, docs: [{ id: 'd1', name: 'D', width: 10, height: 10, layers: [{ id: 'l1', type: 'raster', name: 'L', sourceAssetId: 'a3' }] }] } as never },
    });
    expect(generationPlace(gChat)).toMatchObject({ canvas: 'chat', target: { kind: 'card' } });
    expect(generationPlace(gNode)).toMatchObject({ canvas: 'node', target: { kind: 'node', nodeId: 'n1' } });
    expect(generationPlace(gDes)).toMatchObject({ canvas: 'designer', target: { kind: 'layer', docId: 'd1', layerId: 'l1' } });
  });
});
