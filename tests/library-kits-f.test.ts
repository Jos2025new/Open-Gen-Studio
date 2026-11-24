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
  return {
    blobs,
    assetBlobs,
    dims,
    setOnSet: (fn: ((key: string) => void | Promise<void>) | null) => { onSetHook = fn; },
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> { if (onSetHook) await onSetHook(key); blobs.set(key, value); },
      async del(key: string): Promise<void> { blobs.delete(key); },
      async delMany(keys: string[]): Promise<void> { for (const k of keys) blobs.delete(k); },
    },
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: hoisted.blobDb,
  getAssetBlob: async (id: string) => hoisted.assetBlobs.get(id),
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
    blobToCanvas: async (blob: Blob) => {
      const d = hoisted.dims.get(blob);
      if (!d) throw new Error('corrupt image blob');
      return fakeCanvas(d.w, d.h);
    },
  };
});

import { createItem, deleteItem, libraryToDesigner, readKitVersion, restoreItemVersion, saveItem } from '../src/engine/libraryVersions';
import { createSubjectVoice } from '../src/engine/libraryActions';
import { subjectAssetIds } from '../src/engine/libraryGraph';
import { nodesToLibrary } from '../src/engine/flow/fromLibrary';
import { editCompound } from '../src/engine/nodecore/edit';
import { run, setApprover } from '../src/engine/commands';
import { addTextLayer, getDoc, redoDoc, undoDoc } from '../src/engine/design/actions';
import { newRasterLayer } from '../src/engine/design/doc';
import { createSession, setDoc, useStore } from '../src/store/store';
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
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  return s;
}

beforeEach(() => {
  hoisted.blobs.clear();
  hoisted.assetBlobs.clear();
  hoisted.dims.clear();
  hoisted.setOnSet(null);
});

describe('Lote F fixes', () => {
  it('11) reuses doc-less working copy and places only newly added graph images without duplicating', async () => {
    const s = resetStore();
    useStore.setState({ assets: { img_1: mkAsset('img_1', s.id), img_2: mkAsset('img_2', s.id) } });
    putImageBlob('img_1');
    putImageBlob('img_2');

    // Moodboard created via Add to moodboard flow (graph-only, no doc)
    const n1 = { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'asset' as const, title: 'Img 1', assetId: 'img_1' } };
    const { subject: mb } = await createItem({ name: 'Moodboard 1', kind: 'moodboard', space: 'studio', by: 'user', sessionId: s.id, graph: { nodes: [n1], edges: [] }, draft: false, open: false });

    const doc1 = await libraryToDesigner(s.id, mb.id);
    expect(doc1.layers.filter((l): l is RasterLayer => l.type === 'raster').map((l) => l.sourceAssetId)).toEqual(['img_1']);

    // Add second image to moodboard (exact Add to moodboard pattern: sessionId, no docId)
    const n2 = { id: 'n2', position: { x: 0, y: 0 }, data: { kind: 'asset' as const, title: 'Img 2', assetId: 'img_2' } };
    await saveItem({ subjectId: mb.id, mode: 'overwrite', space: 'studio', by: 'user', sessionId: s.id, graph: (g) => ({ ...(g ?? { nodes: [], edges: [] }), nodes: [...(g?.nodes ?? []), n2] }) as Graph });

    // Reopen: same working copy, both images, no duplicates
    const doc2 = await libraryToDesigner(s.id, mb.id);
    expect(doc2.id).toBe(doc1.id);
    expect(doc2.layers.filter((l): l is RasterLayer => l.type === 'raster').map((l) => l.sourceAssetId)).toEqual(['img_1', 'img_2']);
  });

  it('1) deleteItem removes library entry and detaches working docs without deleting version or raster blobs', async () => {
    const s = resetStore();
    const { subject: kit, doc } = await createItem({ name: 'KeepBlobs', kind: 'design-system', space: 'designer', sessionId: s.id, by: 'user' });
    const lyr: RasterLayer = { ...newRasterLayer('Logo', { x: 0, y: 0, width: 4, height: 4 }, { width: 4, height: 4 }), rev: 1 };
    setDoc(s.id, doc!.id, (d) => ({ ...d, layers: [lyr] }));
    hoisted.blobs.set(`raster:${lyr.id}`, new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));

    const saved = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc!.id, space: 'designer', by: 'user' });
    const snap = await readKitVersion(saved.versionId!);
    const storedRasterId = snap!.doc!.layers[0].id;

    await deleteItem(kit.id);
    expect(useStore.getState().library.some((x) => x.id === kit.id)).toBe(false);
    expect(useStore.getState().sessions[s.id].docs.find((d) => d.id === doc!.id)?.library).toBeUndefined();
    // Blobs remain intact so a failed state write never loses data
    expect(hoisted.blobs.has(`libver:${saved.versionId}`)).toBe(true);
    expect(hoisted.blobs.has(`raster:${storedRasterId}`)).toBe(true);
  });

  it('2) saveItem captures working doc only with explicit docId (never via session lookup from Nodes, agent without doc, or Add to moodboard)', async () => {
    const s = resetStore();
    const { subject: kit, doc } = await createItem({ name: 'BrandDoc', kind: 'brand-kit', space: 'designer', sessionId: s.id, by: 'user' });
    setDoc(s.id, doc!.id, (d) => ({ ...d, background: '#111111' }));
    await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc!.id, space: 'designer', by: 'user', label: 'v1' });

    // Edit local Designer working copy without saving
    setDoc(s.id, doc!.id, (d) => ({ ...d, background: '#ff0000' }));

    // Save from Nodes in the same session: must keep v1's doc (#111111), NOT capture local edit (#ff0000)
    expect(editCompound(s.id, 'seed', (g) => ({
      ...g,
      nodes: [{ id: 'nt1', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Note', text: 'From nodes' } }],
      groups: [{ id: 'grp1', title: 'BrandDoc', nodeIds: ['nt1'], library: { subjectId: kit.id } }],
    }))).toBeNull();
    const fromNodes = await nodesToLibrary({ sessionId: s.id, mode: 'overwrite', subjectId: kit.id, groupId: 'grp1', by: 'user' });
    expect((await readKitVersion(fromNodes.versionId!))?.doc?.background).toBe('#111111');

    // Agent library.item.save without doc in the same session: must also NOT capture local edit
    const agentRes = await run({ cmd: 'library.item.save', on: { session: s.id, doc: doc!.id }, args: { id: kit.id, mode: 'overwrite', label: 'agent-meta' } }, { caller: 'agent' });
    expect(agentRes.ok).toBe(true);
    const liveKit = useStore.getState().library.find((x) => x.id === kit.id)!;
    expect((await readKitVersion(liveKit.versionId!))?.doc?.background).toBe('#111111');
  });

  it('3) commitVersion rejects and cleans up written blobs if a newly validated asset is deleted mid-flight', async () => {
    const s = resetStore();
    useStore.setState({ assets: { ast_new: mkAsset('ast_new', s.id), ast_new2: mkAsset('ast_new2', s.id) } });
    const keysBefore = new Set(hoisted.blobs.keys());
    hoisted.setOnSet((k) => {
      if (k.startsWith('libver:')) useStore.setState((st) => { const { ast_new: _drop, ...rest } = st.assets; return { assets: rest }; });
    });
    const g1: Graph = { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Pic', assetId: 'ast_new' } }], edges: [] };
    await expect(createItem({ name: 'RaceCreate', kind: 'moodboard', space: 'library', by: 'user', graph: g1, draft: false })).rejects.toThrow(/asset|deleted|missing/i);
    expect(useStore.getState().library.some((x) => x.name === 'RaceCreate')).toBe(false);
    expect([...hoisted.blobs.keys()].filter((k) => !keysBefore.has(k))).toEqual([]);

    hoisted.setOnSet(null);
    const { subject: kit } = await createItem({ name: 'RaceSave', kind: 'moodboard', space: 'library', by: 'user', draft: false });
    const keysBeforeSave = new Set(hoisted.blobs.keys());
    hoisted.setOnSet((k) => {
      if (k.startsWith('libver:')) useStore.setState((st) => { const { ast_new2: _drop, ...rest } = st.assets; return { assets: rest }; });
    });
    const g2: Graph = { nodes: [{ id: 'n2', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Pic2', assetId: 'ast_new2' } }], edges: [] };
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'user', graph: g2 })).rejects.toThrow(/asset|deleted|missing/i);
    expect([...hoisted.blobs.keys()].filter((k) => !keysBeforeSave.has(k))).toEqual([]);
  });

  it('4) nodesToLibrary normalizes asset nodes with nodeOutputAsset (including sketch) and strips sketchAssetId/extra fields', async () => {
    const s = resetStore();
    useStore.setState({ assets: { ast_orig: mkAsset('ast_orig', s.id), ast_sketch: mkAsset('ast_sketch', s.id) } });
    expect(editCompound(s.id, 'seed-sketch', (g) => ({
      ...g,
      nodes: [
        { id: 'na1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Sketched', assetId: 'ast_orig', sketchAssetId: 'ast_sketch', extra: 1 } as never },
        { id: 'na2', position: { x: 200, y: 0 }, data: { kind: 'asset', title: 'Plain', assetId: 'ast_orig', extra: 2 } as never },
      ],
    }))).toBeNull();

    const saved = await nodesToLibrary({ sessionId: s.id, mode: 'new', kind: 'moodboard', nodeIds: ['na1', 'na2'], name: 'SketchKit', by: 'user' });
    const d1 = saved.graph!.nodes.find((n) => n.id === 'na1')!.data;
    const d2 = saved.graph!.nodes.find((n) => n.id === 'na2')!.data;
    expect(d1).toEqual({ kind: 'asset', title: 'Sketched', assetId: 'ast_sketch' });
    expect(d2).toEqual({ kind: 'asset', title: 'Plain', assetId: 'ast_orig' });
    expect(subjectAssetIds(saved)).toContain('ast_sketch');
  });

  it('5) undoDoc and redoDoc preserve current library link, view, and detached local-copy name', async () => {
    const s = resetStore();
    const { subject: kit, doc } = await createItem({ name: 'UndoKit', kind: 'design-system', space: 'studio', sessionId: s.id, by: 'user' });
    addTextLayer(s.id, doc!.id, 'Step 1', { x: 0, y: 0, width: 100 });
    const v1 = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc!.id, space: 'studio', by: 'user' });
    addTextLayer(s.id, doc!.id, 'Step 2', { x: 0, y: 40, width: 100 });
    const v2 = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc!.id, space: 'studio', by: 'user' });
    expect(v2.docRev).not.toBe(v1.docRev);

    // Undo/redo while linked keeps latest docRev
    undoDoc(s.id, doc!.id);
    expect(getDoc(s.id, doc!.id)?.library?.docRev).toBe(v2.docRev);
    redoDoc(s.id, doc!.id);
    expect(getDoc(s.id, doc!.id)?.library?.docRev).toBe(v2.docRev);

    // Delete kit -> detaches doc with view:'studio' and '(local copy)' name; undo/redo must NOT re-link or drop view/name
    await deleteItem(kit.id);
    undoDoc(s.id, doc!.id);
    const afterUndo = getDoc(s.id, doc!.id)!;
    expect(afterUndo.library).toBeUndefined();
    expect(afterUndo.view).toBe('studio');
    expect(afterUndo.name).toBe('UndoKit (local copy)');
    expect(afterUndo.layers).toHaveLength(1);

    redoDoc(s.id, doc!.id);
    const afterRedo = getDoc(s.id, doc!.id)!;
    expect(afterRedo.library).toBeUndefined();
    expect(afterRedo.view).toBe('studio');
    expect(afterRedo.name).toBe('UndoKit (local copy)');
    expect(afterRedo.layers).toHaveLength(2);
  });

  it('6) restoreItemVersion rejects cycles via validateContent and commitVersion revalidates cycles inside setState', async () => {
    resetStore();
    const { subject: kitB } = await createItem({ name: 'KitB', kind: 'brand-kit', space: 'library', by: 'user', draft: false });
    const { subject: kitA } = await createItem({ name: 'KitA', kind: 'brand-kit', space: 'library', by: 'user', kits: [kitB.id], draft: false });
    const aV1 = kitA.versionId!;
    await saveItem({ subjectId: kitA.id, mode: 'overwrite', space: 'library', by: 'user', kits: [] });
    await saveItem({ subjectId: kitB.id, mode: 'overwrite', space: 'library', by: 'user', kits: [kitA.id] });

    // Restoring A's v1 (which contains B) would create A -> B -> A
    await expect(restoreItemVersion({ subjectId: kitA.id, versionId: aV1, space: 'library', by: 'user' })).rejects.toThrow(/cycle/i);

    // Concurrent race: B starts containing A while A is writing libver: to contain B
    await saveItem({ subjectId: kitB.id, mode: 'overwrite', space: 'library', by: 'user', kits: [] });
    const keysBefore = new Set(hoisted.blobs.keys());
    hoisted.setOnSet((k) => {
      if (k.startsWith('libver:')) {
        useStore.setState((st) => ({ library: st.library.map((x) => (x.id === kitB.id ? { ...x, kits: [kitA.id] } : x)) }));
      }
    });
    await expect(saveItem({ subjectId: kitA.id, mode: 'overwrite', space: 'library', by: 'user', kits: [kitB.id] })).rejects.toThrow(/cycle/i);
    expect([...hoisted.blobs.keys()].filter((k) => !keysBefore.has(k))).toEqual([]);
  });

  it('7) library.voice.create and createSubjectVoice reject a kit before preparing generation', async () => {
    const s = resetStore();
    const audio: Asset = { id: 'aud_1', sessionId: s.id, kind: 'audio', mime: 'audio/mpeg', width: 0, height: 0, origin: 'upload', stored: true, favorite: false, createdAt: 1 };
    useStore.setState((st) => ({ assets: { aud_1: audio }, composer: { ...st.composer, attachments: ['aud_1'] }, ui: { ...st.ui, toasts: [] } }));
    const { subject: kit } = await createItem({ name: 'MoodVoice', kind: 'moodboard', space: 'library', by: 'user', draft: false });

    const approver = vi.fn(() => true);
    setApprover(approver);
    try {
      const cmdRes = await run({ cmd: 'library.voice.create', on: { session: s.id }, args: { subject: kit.id } }, { caller: 'agent' });
      expect(cmdRes).toMatchObject({ ok: false, error: { code: 'unavailable' } });
      expect(Object.keys(useStore.getState().generations)).toEqual([]);

      await createSubjectVoice(s.id, kit.id);
      expect(Object.keys(useStore.getState().generations)).toEqual([]);
      expect(useStore.getState().ui.toasts.some((t) => /kit|library item|voice/i.test(t.text))).toBe(true);
    } finally {
      setApprover(null);
    }
  });

  it('8) write commands (create/save/open/restore) return only ids (and doc/versionId), never Subject or graph, while read keeps trimmed text', async () => {
    const s = resetStore();
    const g: Graph = { nodes: [{ id: 'nt', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Prompt', text: 'Secret prompt body' } }], edges: [] };

    const created = await run({ cmd: 'library.item.create', on: { session: s.id }, args: { name: 'SlimOut', kind: 'moodboard', space: 'designer', graph: g } }, { caller: 'agent' });
    expect(created.ok).toBe(true);
    const cRes = created.results[0] as Record<string, unknown>;
    expect(Object.keys(cRes).sort()).toEqual(['doc', 'id', 'versionId']);
    expect('subject' in cRes || 'graph' in cRes).toBe(false);
    const kitId = cRes.id as string;
    const v1 = cRes.versionId as string;

    const saved = await run({ cmd: 'library.item.save', on: { session: s.id }, args: { id: kitId, mode: 'overwrite', space: 'library', graph: g } }, { caller: 'agent' });
    expect(saved.ok).toBe(true);
    const sRes = saved.results[0] as Record<string, unknown>;
    expect(Object.keys(sRes).sort()).toEqual(['id', 'versionId']);
    expect(JSON.stringify(sRes)).not.toContain('Secret prompt body');

    const opened = await run({ cmd: 'library.item.open', on: { session: s.id }, args: { id: kitId, space: 'nodes' } }, { caller: 'agent' });
    expect(opened.ok).toBe(true);
    expect(Object.keys(opened.results[0] as Record<string, unknown>).sort()).toEqual(['edges', 'groupId', 'nodes']);

    const restored = await run({ cmd: 'library.item.restore', args: { id: kitId, versionId: v1, space: 'library' } }, { caller: 'agent' });
    expect(restored.ok).toBe(true);
    const rRes = restored.results[0] as Record<string, unknown>;
    expect(Object.keys(rRes).sort()).toEqual(['id', 'versionId']);
    expect(JSON.stringify(rRes)).not.toContain('Secret prompt body');

    const read = await run({ cmd: 'library.item.read', args: { id: kitId } }, { caller: 'agent' });
    expect(read.ok).toBe(true);
    expect((read.results[0] as { index: string }).index).toContain('Secret prompt body');
  });
});
