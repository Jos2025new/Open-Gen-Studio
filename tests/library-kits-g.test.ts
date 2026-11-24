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

import { createItem, libraryToDesigner, renameItem, saveItem } from '../src/engine/libraryVersions';
import { deleteLayer, getDoc, mergeDown, placeAsset } from '../src/engine/design/actions';
import { createSession, useStore } from '../src/store/store';
import type { Asset, Graph, RasterLayer } from '../src/engine/types';

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
    renameItem(mb.id, { name: 'Board AB Renamed', by: 'user' });
    const afterRename = await libraryToDesigner(s.id, mb.id);
    expect(afterRename.name).toBe('Board AB Renamed');
    expect(rasterSources(afterRename)).toEqual(['b']);

    // Add C to moodboard (new version) and reopen: brings ONLY C, does NOT resurrect A
    const v2 = await saveItem({ subjectId: mb.id, mode: 'overwrite', space: 'library', by: 'user', graph: { nodes: [nA, nB, nC], edges: [] } });
    const afterAddC = await libraryToDesigner(s.id, mb.id);
    expect(afterAddC.id).toBe(doc1.id);
    expect(rasterSources(afterAddC)).toEqual(['b', 'c']);
    expect(afterAddC.library?.versionId).toBe(v2.versionId);

    // Unreadable linked version: must NOT add anything and must toast error
    await saveItem({ subjectId: mb.id, mode: 'overwrite', space: 'library', by: 'user', graph: { nodes: [nA, nB, nC, nD], edges: [] } });
    hoisted.blobs.delete(`libver:${v2.versionId}`);
    useStore.setState((st) => ({ ui: { ...st.ui, toasts: [] } }));
    const afterUnreadable = await libraryToDesigner(s.id, mb.id);
    expect(rasterSources(afterUnreadable)).toEqual(['b', 'c']);
    expect(useStore.getState().ui.toasts.some((t) => t.level === 'error')).toBe(true);

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
});
