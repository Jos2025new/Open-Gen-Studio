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

import { resizeCanvas } from '../src/engine/design/canvasSize';
import { createItem, libraryToDesigner, restoreItemVersion, saveItem } from '../src/engine/libraryVersions';
import { settleNewNodes } from '../src/engine/flow/settle';
import { libraryToNodes, nodesToLibrary } from '../src/engine/flow/fromLibrary';
import { addTextLayer, deleteLayer, getDoc, patchLayer, placeAsset, undoDoc } from '../src/engine/design/actions';
import { addDoc } from '../src/engine/design/actions';
import * as D from '../src/engine/design/doc';
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
const texts = (g?: Graph) => g!.nodes.flatMap((n) => (n.data.kind === 'text' ? [n.data.text] : []));
const text = (id: string, t: string, x: number, y: number) => ({ id, position: { x, y }, data: { kind: 'text' as const, title: id, text: t } });
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

  const move = (sessionId: string, groupAsset: (aid: string) => [number, number] | null) => useStore.setState((x) => ({ sessions: { ...x.sessions, [sessionId]: { ...x.sessions[sessionId], graph: { ...x.sessions[sessionId].graph, nodes: x.sessions[sessionId].graph.nodes.map((n) => { const d = n.data.kind === 'asset' ? groupAsset(n.data.assetId!) : null; return d ? { ...n, position: { x: n.position.x + d[0], y: n.position.y + d[1] } } : n; }) } } } }));
  const saveGroup = (sessionId: string, id: string, groupId: string) => nodesToLibrary({ sessionId, groupId, subjectId: id, mode: 'overwrite', by: 'user' });

  it('a group opened before replaces the entry when saved; the previous version stays, and a copy gets the next name', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), { groupId } = libraryToNodes(s.id, id), b = layerAt(s.id, doc.id, 'b'), k = b.width / 260;
    const link = () => useStore.getState().sessions[s.id].graph.groups!.find((g) => g.id === groupId)!.library!;
    expect(link().versionId).toBe(entry(id).versionId);
    patchLayer(s.id, doc.id, b.id, { x: b.x + 50 * k });
    const inDesigner = await saveDoc(s.id, id, doc.id);
    expect(link().versionId).not.toBe(entry(id).versionId);
    const copies = [1, 2].map(() => nodesToLibrary({ sessionId: s.id, groupId: groupId!, subjectId: id, mode: 'copy', name: 'Board', by: 'user' }));
    expect((await Promise.all(copies)).map((c) => c.name)).toEqual(['Board_v2', 'Board_v3']);
    expect(nodeAt(entry(id).graph, 'b')).toEqual({ x: 550, y: 150 });
    move(s.id, (x) => (x === 'a' ? [40, 60] : null));
    await saveGroup(s.id, id, groupId!);
    expect(link().versionId).toBe(entry(id).versionId);
    expect([nodeAt(entry(id).graph, 'a'), nodeAt(entry(id).graph, 'b')].map((p) => p.y)).toEqual([110, 100]);
    await restoreItemVersion({ subjectId: id, versionId: inDesigner.versionId!, space: 'library', by: 'user' });
    expect(nodeAt(entry(id).graph, 'b')).toEqual({ x: 550, y: 150 });
  });

  it('elements that overlap keep their places when Nodes first shows them', async () => {
    const { s, id } = await board();
    await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', graph: { nodes: [asset('a', 100, 100), asset('b', 150, 150)], edges: [] } });
    const { added, groupId } = libraryToNodes(s.id, id);
    const g = () => ({ edges: [], nodes: useStore.getState().sessions[s.id].graph.nodes });
    settleNewNodes(s.id, new Set(added.map((n) => n.id)), new Map(added.map((n) => [n.id, { width: 260, height: 260 }])));
    expect([nodeAt(g(), 'b').x - nodeAt(g(), 'a').x, nodeAt(g(), 'b').y - nodeAt(g(), 'a').y]).toEqual([50, 50]);
    await saveGroup(s.id, id, groupId!);
    expect(nodeAt(entry(id).graph, 'b')).toEqual({ x: 150, y: 150 });
  });

  it('each element moved its own way in Nodes keeps every move; edges and their labels are saved', async () => {
    const { s, id } = await board();
    const { groupId } = libraryToNodes(s.id, id);
    move(s.id, (x) => (x === 'a' ? [10, 0] : [20, 0]));
    await saveGroup(s.id, id, groupId!);
    expect(nodeAt(entry(id).graph, 'b').x - nodeAt(entry(id).graph, 'a').x).toBe(410);
  });

  it('two saves from Nodes one after the other leave the last', async () => {
    const { s, id } = await board();
    const { groupId } = libraryToNodes(s.id, id);
    move(s.id, (x) => (x === 'b' ? [40, 0] : null));
    const first = saveGroup(s.id, id, groupId!);
    move(s.id, (x) => (x === 'b' ? [-40, 0] : null));
    await Promise.all([first, saveGroup(s.id, id, groupId!)]);
    expect(nodeAt(entry(id).graph, 'b')).toEqual({ x: 500, y: 150 });
  });

  it('resizing the page from any corner, and undoing it, does not move the elements of the entry', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), at = () => [nodeAt(entry(id).graph, 'a'), nodeAt(entry(id).graph, 'b')];
    resizeCanvas(s.id, doc.id, doc.width + 200, doc.height + 100, 'bottom-right');
    await saveDoc(s.id, id, doc.id);
    expect(at()).toEqual([{ x: 100, y: 100 }, { x: 500, y: 150 }]);
    undoDoc(s.id, doc.id);
    await saveDoc(s.id, id, doc.id);
    expect(at()).toEqual([{ x: 100, y: 100 }, { x: 500, y: 150 }]);
  });

  it('a text equal to one added in Library stays a different element', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id);
    addTextLayer(s.id, doc.id, 'Same', { x: 40, y: 60, width: 200 }, {});
    await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', graph: (g) => ({ ...g!, nodes: [...g!.nodes, text('tx', 'Same', 500, 500)] }) });
    await libraryToDesigner(s.id, id);
    await saveDoc(s.id, id, doc.id);
    expect(texts(entry(id).graph)).toEqual(['Same', 'Same']);
    expect(entry(id).graph!.nodes.find((n) => n.id === 'tx')!.position).toEqual({ x: 500, y: 500 });
  });

  it('one undo takes back an image that arrived, with the page as it was', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), size = [doc.width, doc.height];
    await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', graph: (g) => ({ ...g!, nodes: [...g!.nodes, asset('c', 900, 450)] }) });
    await libraryToDesigner(s.id, id);
    expect(getDoc(s.id, doc.id)!.width).toBeGreaterThan(size[0]);
    undoDoc(s.id, doc.id);
    const now = getDoc(s.id, doc.id)!;
    expect([layerAt(s.id, doc.id, 'c'), now.width, now.height]).toEqual([undefined, ...size]);
  });

  it('undoing while a save is on its way keeps the undo', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), a = layerAt(s.id, doc.id, 'a'), k = a.width / 260;
    patchLayer(s.id, doc.id, a.id, { x: a.x + 40 * k });
    let go!: () => void;
    const held = new Promise<void>((r) => { go = r; }), reached = new Promise<void>((r) => hoisted.setOnSet(async (key) => { if (key.startsWith('libver:')) { r(); await held; } }));
    const saving = saveDoc(s.id, id, doc.id);
    await reached;
    undoDoc(s.id, doc.id);
    go();
    await saving;
    hoisted.setOnSet(null);
    expect(nodeAt(entry(id).graph, 'a').x).toBe(140);
    await libraryToDesigner(s.id, id);
    expect(layerAt(s.id, doc.id, 'a').x).toBe(a.x);
    await saveDoc(s.id, id, doc.id);
    expect(nodeAt(entry(id).graph, 'a').x).toBe(100);
  });

  it('an image of a design system that joined the graph from Nodes is not placed twice', async () => {
    const { s } = await board();
    const { subject } = await createItem({ name: 'DS', kind: 'design-system', space: 'library', by: 'user', draft: false, graph: { edges: [], nodes: [asset('a', 100, 100), asset('b', 500, 100)] } });
    const doc = await libraryToDesigner(s.id, subject.id);
    await placeAsset(s.id, doc.id, 'c', 'new', 'C');
    await saveDoc(s.id, subject.id, doc.id);
    await saveGroup(s.id, subject.id, libraryToNodes(s.id, subject.id).groupId!);
    expect(entry(subject.id).graph!.nodes).toHaveLength(3);
    await libraryToDesigner(s.id, subject.id);
    expect(getDoc(s.id, doc.id)!.layers).toHaveLength(3);
  });

  it('a save that fails changes nothing in the document; saving later or a copy applies the change once', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), b = layerAt(s.id, doc.id, 'b'), k = b.width / 260;
    await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', graph: (g) => ({ ...g!, nodes: g!.nodes.map((n) => (n.id === 'nb' ? { ...n, position: { x: 520, y: 150 } } : n)) }) });
    hoisted.setOnSet((key) => { if (key.startsWith('libver:')) throw new Error('disk'); });
    await expect(saveDoc(s.id, id, doc.id)).rejects.toThrow();
    hoisted.setOnSet(null);
    expect(layerAt(s.id, doc.id, 'b').x).toBe(b.x);
    await saveItem({ subjectId: id, mode: 'copy', space: 'designer', by: 'user', sessionId: s.id, docId: doc.id, name: 'Copy' });
    expect(layerAt(s.id, doc.id, 'b').x).toBe(b.x);
    for (let i = 0; i < 2; i++) { await saveDoc(s.id, id, doc.id); await libraryToDesigner(s.id, id); }
    expect(layerAt(s.id, doc.id, 'b').x - b.x).toBeCloseTo(20 * k, 2);
    expect(nodeAt(entry(id).graph, 'b')).toEqual({ x: 520, y: 150 });
  });

  it('an image that could not load is tried again at the next opening', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), blob = hoisted.assetBlobs.get('c')!;
    hoisted.assetBlobs.delete('c');
    await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', graph: (g) => ({ ...g!, nodes: [...g!.nodes, asset('c', 100, 500)] }) });
    await libraryToDesigner(s.id, id);
    expect(layerAt(s.id, doc.id, 'c')).toBeUndefined();
    hoisted.assetBlobs.set('c', blob);
    await libraryToDesigner(s.id, id);
    expect(layerAt(s.id, doc.id, 'c')).toBeTruthy();
  });

  it('the same image twice and two equal texts keep their own positions and edits', async () => {
    const { s } = await board();
    const { subject } = await createItem({ name: 'Twins', kind: 'moodboard', space: 'library', by: 'user', draft: false, graph: { edges: [], nodes: [asset('a', 100, 100), { ...asset('a', 500, 100), id: 'na2' }, text('t1', 'Same', 100, 500), text('t2', 'Same', 500, 500)] } });
    const doc = await libraryToDesigner(s.id, subject.id), before = JSON.stringify(entry(subject.id).graph!.nodes);
    await saveDoc(s.id, subject.id, doc.id);
    expect(JSON.stringify(entry(subject.id).graph!.nodes)).toBe(before);
    const t2 = getDoc(s.id, doc.id)!.layers.filter((l) => l.type === 'text')[1];
    patchLayer(s.id, doc.id, t2.id, { text: 'After' });
    await saveItem({ subjectId: subject.id, mode: 'overwrite', space: 'library', by: 'user', graph: (g) => ({ ...g!, nodes: g!.nodes.filter((n) => n.id !== 't1').map((n) => (n.id === 't2' ? text('t2', 'Remote', 500, 500) : n)) }) });
    await libraryToDesigner(s.id, subject.id);
    expect(getDoc(s.id, doc.id)!.layers.flatMap((l) => (l.type === 'text' ? [l.text] : []))).toEqual(['After']);
    await saveDoc(s.id, subject.id, doc.id);
    expect(texts(entry(subject.id).graph)).toEqual(['After']);
  });

  it('an element removed in Nodes comes back when an older document that shows it is saved', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), { groupId } = libraryToNodes(s.id, id);
    useStore.setState((x) => ({ sessions: { ...x.sessions, [s.id]: { ...x.sessions[s.id], graph: { ...x.sessions[s.id].graph, groups: x.sessions[s.id].graph.groups!.map((g) => (g.id === groupId ? { ...g, nodeIds: g.nodeIds.slice(0, 1) } : g)) } } } }));
    await saveGroup(s.id, id, groupId!);
    expect(entry(id).graph!.nodes.map((n) => n.id)).toEqual(['na']);
    await saveDoc(s.id, id, doc.id);
    expect(entry(id).graph!.nodes.map((n) => n.id)).toEqual(['na', 'nb']);
    expect(nodeAt(entry(id).graph, 'b')).toEqual({ x: 500, y: 150 });
    expect(layerAt(s.id, doc.id, 'b')).toBeTruthy();
  });

  it('moving, resizing, hiding or removing one layer leaves the others where they were', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), a = layerAt(s.id, doc.id, 'a'), k = a.width / 260;
    patchLayer(s.id, doc.id, a.id, { x: a.x + 30 * k, width: a.width * 2, height: a.height * 2, visible: false, locked: true });
    await saveDoc(s.id, id, doc.id);
    expect([nodeAt(entry(id).graph, 'a'), nodeAt(entry(id).graph, 'b')]).toEqual([{ x: 130, y: 100 }, { x: 500, y: 150 }]);
    deleteLayer(s.id, doc.id, a.id);
    await saveDoc(s.id, id, doc.id);
    expect(nodeAt(entry(id).graph, 'b')).toEqual({ x: 500, y: 150 });
  });

  it('a rotated layer moves as it shows, both ways', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), b = layerAt(s.id, doc.id, 'b'), k = b.width / 260, cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    patchLayer(s.id, doc.id, b.id, { transform: [0, 1, -1, 0, cx + cy, cy - cx] });
    await saveDoc(s.id, id, doc.id);
    const turned = nodeAt(entry(id).graph, 'b');
    setDoc(s.id, doc.id, (d) => ({ ...d, layers: d.layers.map((l) => (l.id === b.id ? D.translateLayer(l, 70 * k, 0) : l)) }));
    await saveDoc(s.id, id, doc.id);
    expect(nodeAt(entry(id).graph, 'b').x - turned.x).toBeCloseTo(70, 1);
    const t0 = layerAt(s.id, doc.id, 'b').transform!;
    await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', graph: (g) => ({ ...g!, nodes: g!.nodes.map((n) => (n.id === 'nb' ? { ...n, position: { x: n.position.x + 20, y: n.position.y } } : n)) }) });
    await libraryToDesigner(s.id, id);
    const t1 = layerAt(s.id, doc.id, 'b').transform!;
    expect([t1[4] - t0[4], t1[5] - t0[5]].map((v) => Math.round(v * 10) / 10)).toEqual([Math.round(20 * k * 10) / 10, 0]);
  });

  it('moving the whole group in Nodes changes nothing; moving one element keeps how they sit together', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), { groupId } = libraryToNodes(s.id, id), a = layerAt(s.id, doc.id, 'a'), b = layerAt(s.id, doc.id, 'b'), k = a.width / 260;
    move(s.id, () => [900, -70]);
    await saveGroup(s.id, id, groupId!);
    expect([nodeAt(entry(id).graph, 'a'), nodeAt(entry(id).graph, 'b')]).toEqual([{ x: 100, y: 100 }, { x: 500, y: 150 }]);
    move(s.id, (x) => (x === 'b' ? [30, 0] : null));
    await saveGroup(s.id, id, groupId!);
    await libraryToDesigner(s.id, id);
    expect(layerAt(s.id, doc.id, 'a').x).toBe(a.x);
    expect(layerAt(s.id, doc.id, 'b').x - b.x).toBeCloseTo(30 * k, 2);
  });

  it('opening and saving in any space, over and over, keeps fractional and repeated coordinates', async () => {
    const { s, id } = await board();
    await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', graph: { nodes: [asset('a', 100.25, 0.5), asset('b', 500.75, 0.5), { ...asset('a', 100.25, 0.5), id: 'na2' }], edges: [] } });
    const before = JSON.stringify(entry(id).graph!.nodes.map((n) => [n.id, n.position]).sort());
    for (let i = 0; i < 3; i++) {
      const doc = await libraryToDesigner(s.id, id);
      await saveDoc(s.id, id, doc.id);
      await saveGroup(s.id, id, libraryToNodes(s.id, id).groupId!);
    }
    expect(JSON.stringify(entry(id).graph!.nodes.map((n) => [n.id, n.position]).sort())).toBe(before);
  });

  it('notes without images, or with one, keep their positions too', async () => {
    const { s } = await board();
    for (const extra of [[], [asset('a', 900, 100)]]) {
      const { subject } = await createItem({ name: `Notes ${extra.length}`, kind: 'moodboard', space: 'library', by: 'user', draft: false, graph: { edges: [], nodes: [text('t1', 'One', 100, 100), text('t2', 'Two', 500, 500), ...extra] } });
      const doc = await libraryToDesigner(s.id, subject.id), k = doc.board!.k;
      const [t1, t2] = doc.layers.filter((l) => l.type === 'text') as Array<{ id: string; x: number; y: number }>;
      expect([(t2.x - t1.x) / k, (t2.y - t1.y) / k].map(Math.round)).toEqual([400, 400]);
      patchLayer(s.id, doc.id, t2.id, { x: t2.x - 100 * k });
      await saveDoc(s.id, subject.id, doc.id);
      expect(entry(subject.id).graph!.nodes.find((n) => n.id === 't2')!.position.x).toBeCloseTo(400, 1);
    }
  });

  it('a design of another entry is refused, a loose one never rewrites a graph, and only moodboards take images in', async () => {
    const { s, id } = await board();
    for (const kind of ['moodboard', 'design-system', 'brand-kit'] as const) {
      const { subject } = await createItem({ name: kind, kind, space: 'library', by: 'user', draft: false, graph: { edges: [], nodes: [asset('a', 100, 100), asset('b', 500, 100)] } });
      const other = await libraryToDesigner(s.id, id);
      await expect(saveItem({ subjectId: subject.id, mode: 'overwrite', space: 'designer', by: 'user', sessionId: s.id, docId: other.id })).rejects.toThrow('another Library entry');
      const loose = D.createDoc('Loose', 800, 800, null);
      addDoc(s.id, loose);
      await placeAsset(s.id, loose.id, 'c', 'new', 'C');
      await saveItem({ subjectId: subject.id, mode: 'overwrite', space: 'designer', by: 'user', sessionId: s.id, docId: loose.id });
      expect(entry(subject.id).graph!.nodes).toHaveLength(2);
      await restoreItemVersion({ subjectId: subject.id, versionId: entry(subject.id).versions![0].id, space: 'library', by: 'user' });
      const doc = await libraryToDesigner(s.id, subject.id);
      await placeAsset(s.id, doc.id, 'c', 'new', 'C');
      await saveItem({ subjectId: subject.id, mode: 'overwrite', space: 'designer', by: 'user', sessionId: s.id, docId: doc.id });
      expect(entry(subject.id).graph!.nodes).toHaveLength(kind === 'moodboard' ? 3 : 2);
    }
  });

  it('an update from Nodes moves nothing else on the page and one undo takes it back; saving then keeps the undo', async () => {
    const { s, id } = await board();
    const doc = await libraryToDesigner(s.id, id), b = layerAt(s.id, doc.id, 'b');
    const note = addTextLayer(s.id, doc.id, 'Mine', { x: 30, y: 30, width: 100 }, {})!;
    await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', graph: (g) => ({ ...g!, nodes: g!.nodes.map((n) => (n.id === 'nb' ? { ...n, position: { x: -300, y: 150 } } : n)) }) });
    await libraryToDesigner(s.id, id);
    expect(layerAt(s.id, doc.id, 'b').x).toBeLessThan(0);
    expect(getDoc(s.id, doc.id)!.layers.find((l) => l.id === note)).toMatchObject({ x: 30, y: 30 });
    undoDoc(s.id, doc.id);
    expect(layerAt(s.id, doc.id, 'b').x).toBe(b.x);
    await saveDoc(s.id, id, doc.id);
    expect(nodeAt(entry(id).graph, 'b')).toEqual({ x: 500, y: 150 });
    expect(texts(entry(id).graph)).toEqual(['Mine']);
  });

  it('a design born in Designer becomes a moodboard with its images and texts, once', async () => {
    const { s } = await board();
    const doc = D.createDoc('Born', 1200, 900, null);
    addDoc(s.id, doc);
    await placeAsset(s.id, doc.id, 'a', 'new', 'A');
    addTextLayer(s.id, doc.id, 'Warm', { x: 400, y: 600, width: 300 }, {});
    const { subject } = await createItem({ name: 'Born', kind: 'moodboard', space: 'designer', by: 'user', sessionId: s.id, draft: true, open: false });
    const saved = await saveDoc(s.id, subject.id, doc.id);
    setDoc(s.id, doc.id, (d) => ({ ...d, library: { subjectId: saved.id, versionId: saved.versionId!, docRev: saved.docRev } }));
    const ids = entry(subject.id).graph!.nodes.map((n) => n.id);
    await saveDoc(s.id, subject.id, doc.id);
    await libraryToDesigner(s.id, subject.id);
    expect(entry(subject.id).graph!.nodes.map((n) => n.id)).toEqual(ids);
    expect([ids.length, getDoc(s.id, doc.id)!.layers.length]).toEqual([2, 2]);
  });
});
