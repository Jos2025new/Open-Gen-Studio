import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  const assetBlobs = new Map<string, Blob>();
  const dims = new Map<Blob, { w: number; h: number }>();
  let onSetHook: ((key: string) => void | Promise<void>) | null = null;
  let onGetAssetHook: ((id: string) => void | Promise<void>) | null = null;
  return {
    blobs,
    assetBlobs,
    dims,
    setOnSet: (fn: ((key: string) => void | Promise<void>) | null) => { onSetHook = fn; },
    setOnGetAsset: (fn: ((id: string) => void | Promise<void>) | null) => { onGetAssetHook = fn; },
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> { if (onSetHook) await onSetHook(key); blobs.set(key, value); },
      async del(key: string): Promise<void> { blobs.delete(key); },
      async delMany(keys: string[]): Promise<void> { for (const k of keys) blobs.delete(k); },
    },
    getAssetBlob: async (id: string) => {
      if (onGetAssetHook) await onGetAssetHook(id);
      return assetBlobs.get(id);
    },
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: hoisted.blobDb,
  getAssetBlob: hoisted.getAssetBlob,
  putAssetBlob: async (id: string, b: Blob) => { hoisted.assetBlobs.set(id, b); },
  deleteAssetBlobs: async (ids: string[]) => { for (const id of ids) hoisted.assetBlobs.delete(id); },
}));

vi.mock('../src/lib/media', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/media')>('../src/lib/media');
  const fakeCanvas = (w: number, h: number) => ({
    width: w,
    height: h,
    getContext: () => ({ drawImage: () => undefined, clearRect: () => undefined }),
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
  }) as unknown as HTMLCanvasElement;
  return {
    ...actual,
    createCanvas: (w: number, h: number) => fakeCanvas(w, h),
    ctx2d: (c: HTMLCanvasElement) => c.getContext('2d'),
    blobToCanvas: async (blob: Blob) => {
      const d = hoisted.dims.get(blob);
      if (!d) throw new Error('corrupt image blob');
      return fakeCanvas(d.w, d.h);
    },
  };
});

vi.mock('../src/engine/design/render', async (orig) => ({
  ...await orig<typeof import('../src/engine/design/render')>(),
  drawDoc: () => undefined,
}));

import { createItem, libraryToDesigner, saveItem } from '../src/engine/libraryVersions';
import { libraryToNodes, nodesToLibrary } from '../src/engine/flow/fromLibrary';
import { deleteLayer, getDoc, patchLayer, placeAsset } from '../src/engine/design/actions';
import { createSession, setDoc, useStore } from '../src/store/store';
import type { Asset, Graph, Layer } from '../src/engine/types';

function mkAsset(id: string, sessionId: string, w = 800, h = 600): Asset {
  return { id, sessionId, kind: 'image', mime: 'image/png', name: `${id}.png`, width: w, height: h, origin: 'upload', stored: true, favorite: false, createdAt: 1 };
}

function putImageBlob(id: string, w = 800, h = 600) {
  const b = new Blob([`img:${id}`], { type: 'image/png' });
  hoisted.assetBlobs.set(id, b);
  hoisted.dims.set(b, { w, h });
}

function resetStore() {
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {}, ui: { ...useStore.getState().ui, toasts: [] } });
  return s;
}

beforeEach(() => {
  hoisted.blobs.clear();
  hoisted.assetBlobs.clear();
  hoisted.dims.clear();
  hoisted.setOnSet(null);
  hoisted.setOnGetAsset(null);
});

const layerAt = (sessionId: string, docId: string, assetId: string) => getDoc(sessionId, docId)!.layers.find((l) => 'sourceAssetId' in l && l.sourceAssetId === assetId) as Extract<Layer, { type: 'raster' }>;
const nodeAt = (g: Graph | undefined, assetId: string) => g!.nodes.find((n) => n.data.kind === 'asset' && n.data.assetId === assetId)!.position;
const asset = (id: string, x: number, y: number) => ({ id: `n${id}`, position: { x, y }, data: { kind: 'asset' as const, title: id, assetId: id } });

describe('one position per element, across Designer, Library and Nodes', () => {
  async function board() {
    const s = resetStore();
    useStore.setState({ assets: Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, mkAsset(id, s.id)])) });
    for (const id of ['a', 'b', 'c', 'd']) putImageBlob(id);
    const { subject } = await createItem({ name: 'Board', kind: 'moodboard', space: 'library', by: 'user', graph: { nodes: [asset('a', 100, 100), asset('b', 500, 150)], edges: [] }, draft: false });
    return { s, id: subject.id };
  }
  const entry = (id: string) => useStore.getState().library.find((x) => x.id === id)!;
  const saveDoc = (sessionId: string, id: string, docId: string) => saveItem({ subjectId: id, mode: 'overwrite', space: 'designer', by: 'user', sessionId, docId });

  it('a layer moved in Designer and saved opens moved in Nodes', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), a = layerAt(s.id, doc.id, 'a'), b = layerAt(s.id, doc.id, 'b'), k = a.width / 260;
    expect([(b.x - a.x) / k, (b.y - a.y) / k].map(Math.round)).toEqual([400, 50]);
    patchLayer(s.id, doc.id, b.id, { x: b.x + 100 * k, y: b.y + 200 * k });
    await saveDoc(s.id, id, doc.id);
    expect([nodeAt(entry(id).graph, 'a'), nodeAt(entry(id).graph, 'b')]).toEqual([{ x: 100, y: 100 }, { x: 600, y: 350 }]);
    const { added } = libraryToNodes(s.id, id), g = { nodes: added, edges: [] };
    expect([nodeAt(g, 'b').x - nodeAt(g, 'a').x, nodeAt(g, 'b').y - nodeAt(g, 'a').y]).toEqual([500, 250]);
  });

  it('saving again without touching anything changes neither the graph nor the layers', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id);
    await saveDoc(s.id, id, doc.id);
    const graph = JSON.stringify(entry(id).graph), layers = JSON.stringify(getDoc(s.id, doc.id)!.layers);
    await saveDoc(s.id, id, doc.id);
    await libraryToDesigner(s.id, id);
    expect(JSON.stringify(entry(id).graph)).toBe(graph);
    expect(JSON.stringify(getDoc(s.id, doc.id)!.layers)).toBe(layers);
  });

  for (const reopened of [false, true]) it(`what Nodes moves and adds reaches ${reopened ? 'the saved document, opened again' : 'the copy that is open'}`, async () => {
    const { s, id } = await board();
    let doc = await libraryToDesigner(s.id, id);
    await saveDoc(s.id, id, doc.id);
    const { groupId } = libraryToNodes(s.id, id);
    const st = useStore.getState().sessions[s.id];
    const at = (aid: string) => st.graph.nodes.find((n) => n.data.kind === 'asset' && n.data.assetId === aid)!;
    const graph: Graph = { ...st.graph, nodes: [...st.graph.nodes.map((n) => (n.id === at('b').id ? { ...n, position: { x: n.position.x + 80, y: n.position.y } } : n)), { ...asset('c', at('a').position.x, at('a').position.y + 400), id: 'nc2' }], groups: st.graph.groups!.map((g) => (g.id === groupId ? { ...g, nodeIds: [...g.nodeIds, 'nc2'] } : g)) };
    useStore.setState((x) => ({ sessions: { ...x.sessions, [s.id]: { ...x.sessions[s.id], graph } } }));
    const before = layerAt(s.id, doc.id, 'b'), a = layerAt(s.id, doc.id, 'a'), k = a.width / 260;
    await nodesToLibrary({ sessionId: s.id, groupId: groupId!, subjectId: id, mode: 'overwrite', by: 'user' } as Parameters<typeof nodesToLibrary>[0]);
    if (reopened) { setDoc(s.id, doc.id, ({ library: _gone, ...d }) => d as typeof doc); }
    doc = await libraryToDesigner(s.id, id);
    const a2 = layerAt(s.id, doc.id, 'a'), b2 = layerAt(s.id, doc.id, 'b'), c2 = layerAt(s.id, doc.id, 'c');
    expect((b2.x - a2.x) - (before.x - a.x)).toBeCloseTo(80 * k, 0);
    expect((c2.y - a2.y) / k).toBeCloseTo(400, 0);
    expect(c2.y + c2.height).toBeLessThanOrEqual(doc.height);
  });

  it('an image added from Library to a board with a saved document appears in Designer; one removed there does not come back', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id);
    deleteLayer(s.id, doc.id, layerAt(s.id, doc.id, 'b').id);
    await saveDoc(s.id, id, doc.id);
    setDoc(s.id, doc.id, ({ library: _gone, ...d }) => d as typeof doc);
    await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', graph: (g) => ({ ...g!, nodes: [...g!.nodes, asset('d', 0, 0)] }) });
    const again = await libraryToDesigner(s.id, id);
    expect(again.layers.flatMap((l) => ('sourceAssetId' in l ? [l.sourceAssetId] : []))).toEqual(['a', 'd']);
  });

  it('an image placed in Designer joins the board where it was placed', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), a = layerAt(s.id, doc.id, 'a'), k = a.width / 260;
    await placeAsset(s.id, doc.id, 'c', 'new', 'C');
    patchLayer(s.id, doc.id, layerAt(s.id, doc.id, 'c').id, { x: a.x + 50 * k, y: a.y + 500 * k, width: a.width, height: a.height });
    await saveDoc(s.id, id, doc.id);
    expect(nodeAt(entry(id).graph, 'c')).toEqual({ x: 150, y: 600 });
  });
});
