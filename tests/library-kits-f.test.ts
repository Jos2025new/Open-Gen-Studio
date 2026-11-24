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

import { createItem, deleteItem, libraryToDesigner, readKitVersion, saveItem } from '../src/engine/libraryVersions';
import { nodesToLibrary } from '../src/engine/flow/fromLibrary';
import { editCompound } from '../src/engine/nodecore/edit';
import { run } from '../src/engine/commands';
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
});
