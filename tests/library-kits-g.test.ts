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

import { createItem, libraryToDesigner, readKitVersion, saveItem } from '../src/engine/libraryVersions';
import { deleteAssets } from '../src/engine/assetActions';
import { libraryToNodes, nodesToLibrary } from '../src/engine/flow/fromLibrary';
import { CAPABILITIES } from '../src/engine/agent/tools';
import { run } from '../src/engine/commands';
import { deleteLayer, getDoc, mergeDown, placeAsset, undoDoc } from '../src/engine/design/actions';
import { newRasterLayer } from '../src/engine/design/doc';
import { createSession, setDoc, useStore } from '../src/store/store';
import type { Asset, Graph, RasterLayer, TextLayer } from '../src/engine/types';

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

const rasterSources = (doc: { layers: Array<{ type: string; sourceAssetId?: string }> }) =>
  doc.layers.filter((l): l is RasterLayer => l.type === 'raster').map((l) => l.sourceAssetId);

beforeEach(() => {
  hoisted.blobs.clear();
  hoisted.assetBlobs.clear();
  hoisted.dims.clear();
  hoisted.setOnSet(null);
  hoisted.setOnGetAsset(null);
});

describe('Lote G fixes', () => {
  it('1) openInSpace without docRev: same version adds nothing; new version adds only delta; merge down & rename & unreadable prev version handled', async () => {
    const s = resetStore();
    useStore.setState({ assets: { a: mkAsset('a', s.id), b: mkAsset('b', s.id), c: mkAsset('c', s.id), d: mkAsset('d', s.id) } });
    putImageBlob('a');
    putImageBlob('b');
    putImageBlob('c');
    putImageBlob('d');

    const nA = { id: 'na', position: { x: 0, y: 0 }, data: { kind: 'asset' as const, title: 'Img A', assetId: 'a' } };
    const nB = { id: 'nb', position: { x: 200, y: 0 }, data: { kind: 'asset' as const, title: 'Img B', assetId: 'b' } };
    const nC = { id: 'nc', position: { x: 400, y: 0 }, data: { kind: 'asset' as const, title: 'Img C', assetId: 'c' } };
    const nD = { id: 'nd', position: { x: 600, y: 0 }, data: { kind: 'asset' as const, title: 'Img D', assetId: 'd' } };

    // Moodboard with A and B
    const { subject: mb } = await createItem({ name: 'Board AB', kind: 'moodboard', space: 'library', by: 'user', graph: { nodes: [nA, nB], edges: [] }, draft: false });
    const doc1 = await libraryToDesigner(s.id, mb.id);
    expect(rasterSources(doc1)).toEqual(['a', 'b']);

    // Delete A and reopen (same version): must NOT resurrect A
    const layerA = doc1.layers.find((l) => l.type === 'raster' && l.sourceAssetId === 'a')!;
    deleteLayer(s.id, doc1.id, layerA.id);
    const afterDeleteReopen = await libraryToDesigner(s.id, mb.id);
    expect(afterDeleteReopen.id).toBe(doc1.id);
    expect(rasterSources(afterDeleteReopen)).toEqual(['b']);

    // Rename kit and reopen: working copy name updates as before
    await saveItem({ subjectId: mb.id, mode: 'overwrite', space: 'library', by: 'user', name: 'Board AB Renamed' });
    const afterRename = await libraryToDesigner(s.id, mb.id);
    expect(afterRename.name).toBe('Board AB Renamed');
    expect(rasterSources(afterRename)).toEqual(['b']);

    // Add C to moodboard (new version) and reopen: brings ONLY C, does NOT resurrect A
    const v2 = await saveItem({ subjectId: mb.id, mode: 'overwrite', space: 'library', by: 'user', graph: { nodes: [nA, nB, nC], edges: [] } });
    const afterAddC = await libraryToDesigner(s.id, mb.id);
    const addedC = afterAddC.layers.find((l) => 'sourceAssetId' in l && l.sourceAssetId === 'c') as { x: number; y: number; width: number; height: number };
    // At its own coordinates (200 units right of B) and on a page that grew to hold it.
    const layerB = afterAddC.layers.find((l) => 'sourceAssetId' in l && l.sourceAssetId === 'b') as typeof addedC;
    expect(addedC.x - layerB.x).toBeCloseTo(layerB.width * (200 / 260), 0);
    expect(addedC.x >= 0 && addedC.x + addedC.width <= afterAddC.width).toBe(true);
    expect(afterAddC.id).toBe(doc1.id);
    expect(rasterSources(afterAddC)).toEqual(['b', 'c']);
    expect(afterAddC.library?.versionId).toBe(v2.versionId);

    // What to bring is known from the document itself: an older version that cannot be read does not stop it
    await saveItem({ subjectId: mb.id, mode: 'overwrite', space: 'library', by: 'user', graph: { nodes: [nA, nB, nC, nD], edges: [] } });
    hoisted.blobs.delete(`libver:${v2.versionId}`);
    useStore.setState((st) => ({ ui: { ...st.ui, toasts: [] } }));
    const afterUnreadable = await libraryToDesigner(s.id, mb.id);
    expect(rasterSources(afterUnreadable)).toEqual(['b', 'c', 'd']);
    expect(useStore.getState().ui.toasts.some((t) => t.level === 'error')).toBe(false);

    // Merge down in a fresh moodboard and reopen: must NOT duplicate merged layers
    const { subject: mbMerge } = await createItem({ name: 'MergeBoard', kind: 'moodboard', space: 'library', by: 'user', graph: { nodes: [nA, nB], edges: [] }, draft: false });
    const docM = await libraryToDesigner(s.id, mbMerge.id);
    expect(docM.layers).toHaveLength(2);
    const mergedId = await mergeDown(s.id, docM.id, docM.layers[1].id);
    expect(mergedId).toBeTruthy();
    expect(getDoc(s.id, docM.id)!.layers).toHaveLength(1);
    const afterMergeReopen = await libraryToDesigner(s.id, mbMerge.id);
    expect(afterMergeReopen.id).toBe(docM.id);
    expect(afterMergeReopen.layers).toHaveLength(1);
  });

  it('2) openInSpace imports with target "new" so a layer placed during load is never overwritten, preserving 1600x900 doc size', async () => {
    const s = resetStore();
    useStore.setState({ assets: { a: mkAsset('a', s.id, 1600, 900), b: mkAsset('b', s.id, 600, 600) } });
    putImageBlob('a', 1600, 900);
    putImageBlob('b', 600, 600);

    const nA = { id: 'na', position: { x: 0, y: 0 }, data: { kind: 'asset' as const, title: 'Hero 16:9', assetId: 'a' } };
    const { subject: mb } = await createItem({ name: 'WideBoard', kind: 'moodboard', space: 'library', by: 'user', graph: { nodes: [nA], edges: [] }, draft: false });

    // Empty-doc open keeps exact 1600x900 size and places A covering canvas
    const cleanDoc = await libraryToDesigner(s.id, mb.id);
    expect([cleanDoc.width, cleanDoc.height]).toEqual([1600, 900]);
    expect(rasterSources(cleanDoc)).toEqual(['a']);

    // Race: open into a fresh session while A load is paused, place B mid-load
    const s2 = createSession('S2');
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s2.id]: s2 } }));
    let releaseA!: () => void;
    let enteredA!: () => void;
    const waitEnteredA = new Promise<void>((r) => { enteredA = r; });
    const waitReleaseA = new Promise<void>((r) => { releaseA = r; });
    hoisted.setOnGetAsset(async (id) => {
      if (id === 'a') { enteredA(); await waitReleaseA; }
    });

    const opening = libraryToDesigner(s2.id, mb.id);
    await waitEnteredA;
    const activeId = useStore.getState().sessions[s2.id].activeDocId!;
    const layerBId = await placeAsset(s2.id, activeId, 'b', 'new', 'User B');
    expect(layerBId).toBeTruthy();
    releaseA();
    const docRace = await opening;

    expect([docRace.width, docRace.height]).toEqual([1600, 900]);
    const layerB = docRace.layers.find((l) => l.id === layerBId) as RasterLayer | undefined;
    expect(layerB?.sourceAssetId).toBe('b');
    expect(rasterSources(docRace)).toEqual(['b', 'a']);
    undoDoc(s2.id, activeId);
    expect(rasterSources(getDoc(s2.id, activeId)!)).toEqual(['b']);
    undoDoc(s2.id, activeId);
    expect(rasterSources(getDoc(s2.id, activeId)!)).toEqual([]);
  });

  it('3) openInSpace emits error toast with image title on decode error or falsy placeAsset and continues with remaining images', async () => {
    const s = resetStore();
    useStore.setState({
      assets: {
        bad: mkAsset('bad', s.id),
        ok: mkAsset('ok', s.id),
        vanished: mkAsset('vanished', s.id),
        bad2: mkAsset('bad2', s.id),
        ok2: mkAsset('ok2', s.id),
      },
    });
    // bad & bad2 have corrupt blobs (not in dims -> blobToCanvas throws); ok, vanished, ok2 have valid blobs
    hoisted.assetBlobs.set('bad', new Blob(['corrupt'], { type: 'image/png' }));
    hoisted.assetBlobs.set('bad2', new Blob(['corrupt2'], { type: 'image/png' }));
    putImageBlob('ok');
    putImageBlob('vanished');
    putImageBlob('ok2');

    // During ok's blob read, remove vanished from assets so placeAsset returns null without throwing
    hoisted.setOnGetAsset((id) => {
      if (id === 'ok') useStore.setState((st) => { const { vanished: _v, ...rest } = st.assets; return { assets: rest }; });
    });

    const nBad = { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'asset' as const, title: 'Broken Shot', assetId: 'bad' } };
    const nOk = { id: 'n2', position: { x: 100, y: 0 }, data: { kind: 'asset' as const, title: 'Good Shot', assetId: 'ok' } };
    const nVan = { id: 'n3', position: { x: 200, y: 0 }, data: { kind: 'asset' as const, title: 'Vanished Pic', assetId: 'vanished' } };
    const { subject: mb } = await createItem({ name: 'ToastBoard', kind: 'moodboard', space: 'library', by: 'user', graph: { nodes: [nBad, nOk, nVan], edges: [] }, draft: false });

    const doc1 = await libraryToDesigner(s.id, mb.id);
    expect(rasterSources(doc1)).toEqual(['ok']);
    const toasts1 = useStore.getState().ui.toasts.filter((t) => t.level === 'error').map((t) => t.text);
    expect(toasts1.some((t) => t.includes('Broken Shot'))).toBe(true);
    expect(toasts1.some((t) => t.includes('Vanished Pic'))).toBe(true);

    // Reopen delta branch: corrupt image toasts title and valid image still enters
    hoisted.setOnGetAsset(null);
    useStore.setState((st) => ({ ui: { ...st.ui, toasts: [] } }));
    const nBad2 = { id: 'n4', position: { x: 300, y: 0 }, data: { kind: 'asset' as const, title: 'Broken Delta', assetId: 'bad2' } };
    const nOk2 = { id: 'n5', position: { x: 400, y: 0 }, data: { kind: 'asset' as const, title: 'Valid Delta', assetId: 'ok2' } };
    await saveItem({ subjectId: mb.id, mode: 'overwrite', space: 'library', by: 'user', graph: { nodes: [nBad, nOk, nBad2, nOk2], edges: [] } });
    const doc2 = await libraryToDesigner(s.id, mb.id);
    expect(rasterSources(doc2)).toEqual(['ok', 'ok2']);
    const toasts2 = useStore.getState().ui.toasts.filter((t) => t.level === 'error').map((t) => t.text);
    expect(toasts2.some((t) => t.includes('Broken Delta'))).toBe(true);
  });

  it('4) createItem with graph opens via openInSpace with image size, image layer, and text note without duplicate docs or deadlock', async () => {
    const s = resetStore();
    useStore.setState({ assets: { hero: mkAsset('hero', s.id, 1600, 900) } });
    putImageBlob('hero', 1600, 900);

    const graph: Graph = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Hero', assetId: 'hero' } },
        { id: 'n2', position: { x: 200, y: 0 }, data: { kind: 'text', title: 'Mood Note', text: 'Golden light note' } },
      ],
      edges: [],
    };

    const cmdRes = await run(
      { cmd: 'library.item.create', on: { session: s.id }, args: { name: 'StudioBoard', kind: 'moodboard', space: 'studio', graph } },
      { caller: 'agent' },
    );
    expect(cmdRes.ok).toBe(true);
    const out = cmdRes.results[0] as { id: string; versionId?: string; doc?: string };
    expect(Object.keys(out).sort()).toEqual(['doc', 'id']);
    expect(useStore.getState().sessions[s.id].docs).toHaveLength(1);

    const doc = getDoc(s.id, out.doc!)!;
    // The image and its note share a page, at their positions.
    const size = [doc.width, doc.height];
    expect(doc.layers.every((l) => 'x' in l && l.x >= 0 && l.x + l.width <= doc.width)).toBe(true);
    expect(rasterSources(doc)).toEqual(['hero']);
    expect(doc.layers.filter((l): l is TextLayer => l.type === 'text').map((l) => l.text)).toEqual(['Golden light note']);

    // Opening the same entry in Designer reuses that doc, keeping size, image, and text note
    const reopened = await libraryToDesigner(s.id, out.id);
    expect(reopened.id).toBe(doc.id);
    expect(useStore.getState().sessions[s.id].docs).toHaveLength(1);
    expect([reopened.width, reopened.height]).toEqual(size);
    expect(rasterSources(reopened)).toEqual(['hero']);
    expect(reopened.layers.filter((l): l is TextLayer => l.type === 'text').map((l) => l.text)).toEqual(['Golden light note']);

    // Non-draft createItem in designer also preserves return shape { id, versionId, doc } and graph content
    const cmdRes2 = await run(
      { cmd: 'library.item.create', on: { session: s.id }, args: { name: 'PublishedBoard', kind: 'moodboard', space: 'designer', graph, draft: false } },
      { caller: 'agent' },
    );
    expect(cmdRes2.ok).toBe(true);
    const out2 = cmdRes2.results[0] as { id: string; versionId?: string; doc?: string };
    expect(Object.keys(out2).sort()).toEqual(['doc', 'id', 'versionId']);
    const doc2 = getDoc(s.id, out2.doc!)!;
    expect([doc2.width, doc2.height]).toEqual(size);
    expect(doc2.layers.filter((l): l is TextLayer => l.type === 'text').map((l) => l.text)).toEqual(['Golden light note']);
  });

  it('5) libraryToNodes includes both graph nodes and unrepresented current-version images, and saving from Nodes keeps stored doc intact', async () => {
    const s = resetStore();
    useStore.setState({ assets: { a: mkAsset('a', s.id), b: mkAsset('b', s.id) } });
    putImageBlob('a');
    putImageBlob('b');

    const { subject: mb, doc } = await createItem({ name: 'MixedBoard', kind: 'moodboard', space: 'designer', sessionId: s.id, by: 'user' });
    const lyrA: RasterLayer = { ...newRasterLayer('Layer A', { x: 0, y: 0, width: 100, height: 100 }, { width: 100, height: 100 }, 'a'), rev: 1 };
    setDoc(s.id, doc!.id, (d) => ({ ...d, background: '#223344', layers: [lyrA] }));
    hoisted.blobs.set(`raster:${lyrA.id}`, new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' }));
    const v1 = await saveItem({ subjectId: mb.id, mode: 'overwrite', sessionId: s.id, docId: doc!.id, space: 'designer', by: 'user' });

    const first = libraryToNodes(s.id, mb.id);
    expect(first.added.map((n) => (n.data.kind === 'asset' ? n.data.assetId : null))).toEqual(['a']);

    // Add to moodboard B (graph node, no docId)
    const nB = { id: 'nb', position: { x: 0, y: 0 }, data: { kind: 'asset' as const, title: 'Img B', assetId: 'b' } };
    await saveItem({ subjectId: mb.id, mode: 'overwrite', space: 'studio', by: 'user', sessionId: s.id, graph: (g) => ({ ...(g ?? { nodes: [], edges: [] }), nodes: [...(g?.nodes ?? []), nB] }) as Graph });

    const second = libraryToNodes(s.id, mb.id);
    const assetIds = second.added.map((n) => (n.data.kind === 'asset' ? n.data.assetId : null)).sort();
    expect(assetIds).toEqual(['a', 'b']);

    // Edit local working doc without saving, then save from Nodes: stored doc must remain unchanged (#223344)
    setDoc(s.id, doc!.id, (d) => ({ ...d, background: '#ff0000' }));
    const fromNodes = await nodesToLibrary({ sessionId: s.id, mode: 'overwrite', subjectId: mb.id, groupId: second.groupId!, by: 'user' });
    const snapAfter = await readKitVersion(fromNodes.versionId!);
    expect(snapAfter?.doc?.background).toBe('#223344');
    expect(snapAfter?.docRev).toBe(v1.docRev);
  });

  it('6) saveItem with workDoc rejects and cleans up if a layer sourceAssetId present at save start is deleted mid-flight, while already-missing originals still save', async () => {
    const s = resetStore();
    useStore.setState({ assets: { a: mkAsset('a', s.id) } });
    const { subject: kit, doc } = await createItem({ name: 'RaceDocKit', kind: 'moodboard', space: 'designer', sessionId: s.id, by: 'user' });
    const lyrA: RasterLayer = { ...newRasterLayer('Layer A', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }, 'a'), rev: 1 };
    setDoc(s.id, doc!.id, (d) => ({ ...d, layers: [lyrA] }));
    hoisted.blobs.set(`raster:${lyrA.id}`, new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));

    const keysBefore = new Set(hoisted.blobs.keys());
    hoisted.setOnSet((k) => {
      if (k.startsWith('libver:')) deleteAssets(['a']);
    });
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc!.id, space: 'designer', by: 'user' }))
      .rejects.toThrow(/deleted while saving/i);
    expect([...hoisted.blobs.keys()].filter((k) => !keysBefore.has(k))).toEqual([]);

    // Original asset already absent before save starts must NOT block saving
    hoisted.setOnSet(null);
    expect(useStore.getState().assets.a).toBeUndefined();
    const saved = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc!.id, space: 'designer', by: 'user' });
    expect(saved.versionId).toBeTruthy();
    expect((await readKitVersion(saved.versionId!))?.doc?.layers).toHaveLength(1);
  });

  it('8) CAPABILITIES LIBRARY KITS guide states that publishing the canvas requires passing its ID as doc', () => {
    const kitLine = CAPABILITIES.split('\n').find((l) => /LIBRARY KITS/i.test(l));
    expect(kitLine).toBeDefined();
    expect(kitLine!.length).toBeLessThan(400);
    expect(kitLine).toMatch(/pass .*doc|doc\b.*canvas|canvas.*\bdoc\b/i);
  });
});
