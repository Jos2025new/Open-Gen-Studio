import { describe, expect, it, vi } from 'vitest';
import type { Asset } from '../src/engine/types';

vi.hoisted(() => {
  Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));
// Pixels need a browser canvas: placing records the layer only.
const placed: Array<[string, string, string]> = [];
vi.mock('../src/engine/design/actions', async (orig) => ({
  ...(await orig<typeof import('../src/engine/design/actions')>()),
  placeAsset: async (_s: string, docId: string, assetId: string, target: string) => {
    placed.push([docId, assetId, target]);
    return 'layer';
  },
}));

import { useStore } from '../src/store/store';
import { chatImagesNotInDesigner, chatToDesigner } from '../src/engine/design/fromChat';

const asset = (id: string, kind: Asset['kind'], sid: string, g: string): Asset =>
  ({ id, kind, mime: kind === 'image' ? 'image/png' : 'video/mp4', width: 1344, height: 768, sessionId: sid, generationId: g, origin: 'generated', stored: true, favorite: false, createdAt: id.length }) as Asset;

describe('chat → Designer', () => {
  it('each chat image becomes its own design, or all layers of one; video is skipped', async () => {
    const st = useStore.getState();
    const sid = st.activeSessionId;
    const g = (id: string, kind: 'image' | 'video') => ({ id, sessionId: sid, kind, prompt: `Planta ${id}. detail`, status: 'done', assetIds: [], inputs: { refs: [] }, settings: { count: 1 } });
    useStore.setState({
      generations: { ...st.generations, g1: g('g1', 'image'), g2: g('g2', 'image'), g3: g('g3', 'video') } as never,
      assets: { ...st.assets, a1: asset('a1', 'image', sid, 'g1'), a22: asset('a22', 'image', sid, 'g2'), v333: asset('v333', 'video', sid, 'g3') },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], docs: [], activeDocId: null, feed: ['g1', 'g2', 'g3'].map((id, n) => ({ id: `f${n}`, createdAt: n, workspace: 'chat', type: 'generation', generationId: id })) as never } },
    });
    expect(chatImagesNotInDesigner(sid).map((a) => a.id)).toEqual(['a1', 'a22']);

    const r = await chatToDesigner(sid, { assetIds: ['a1', 'v333'] });
    expect(r.docs).toHaveLength(1);
    expect(r.docs[0]).toMatchObject({ name: 'Planta g1', layers: 1 });
    expect(r.skipped).toEqual(['asset:v333 (video)']);
    expect(placed).toEqual([[r.docs[0].id, 'a1', 'base']]);

    placed.length = 0;
    const one = await chatToDesigner(sid, { assetIds: ['a1', 'a22'], as: 'layers' });
    expect(one.docs).toEqual([{ id: one.docs[0].id, name: 'Planta g1', layers: 2 }]);
    expect(placed.map(([, a, t]) => [a, t])).toEqual([['a1', 'base'], ['a22', 'new']]);
    const s = useStore.getState().sessions[sid];
    expect(s.docs).toHaveLength(2);
    expect(s.activeDocId).toBe(one.docs[0].id);
    expect(s.docs[1]).toMatchObject({ width: 1344, height: 768 });
  });
});
