import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  const assetBlobs = new Map<string, Blob>();
  const dims = new Map<Blob, { w: number; h: number }>();
  return {
    blobs,
    assetBlobs,
    dims,
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> { blobs.set(key, value); },
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

import { createItem, libraryToDesigner, libraryToStudio, saveItem } from '../src/engine/libraryVersions';
import { createSession, useStore } from '../src/store/store';
import type { Asset, Graph, RasterLayer, TextLayer } from '../src/engine/types';

function mkAsset(id: string, sessionId: string, w: number, h: number, kind: Asset['kind'] = 'image'): Asset {
  return {
    id, sessionId, kind, mime: kind === 'image' ? 'image/png' : 'video/mp4', name: `${id}.png`,
    width: w, height: h, origin: 'upload', stored: true, favorite: false, createdAt: 1,
  };
}

function putImageBlob(id: string, w: number, h: number) {
  const b = new Blob([`img:${id}`], { type: 'image/png' });
  hoisted.assetBlobs.set(id, b);
  hoisted.dims.set(b, { w, h });
}

beforeEach(() => {
  hoisted.blobs.clear();
  hoisted.assetBlobs.clear();
  hoisted.dims.clear();
  const s1 = createSession('Session 1');
  const s2 = createSession('Session 2');
  useStore.setState({
    sessions: { [s1.id]: s1, [s2.id]: s2 },
    activeSessionId: s1.id,
    library: [],
    assets: {},
    generations: {},
  });
});

describe('Lote E Punto 1: open graph-only Library entry in Studio/Designer', () => {
  it('arranges cross-session images and texts without overlap, in page order', async () => {
    const [s1, s2] = Object.keys(useStore.getState().sessions);
    const a1 = mkAsset('img_a', s2, 1600, 900);
    const a2 = mkAsset('img_b', s2, 800, 800);
    const v1 = mkAsset('vid_c', s1, 1920, 1080, 'video');
    putImageBlob('img_a', 1600, 900);
    putImageBlob('img_b', 800, 800);
    useStore.setState({ assets: { img_a: a1, img_b: a2, vid_c: v1 } });

    const graph: Graph = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Hero Shot', assetId: 'img_a' } },
        { id: 'n2', position: { x: 200, y: 0 }, data: { kind: 'asset', title: 'Detail', assetId: 'img_b' } },
        { id: 'n3', position: { x: 400, y: 0 }, data: { kind: 'asset', title: 'Clip', assetId: 'vid_c' } },
        { id: 'n4', position: { x: 0, y: 200 }, data: { kind: 'text', title: 'Mood Note', text: 'Warm golden light' } },
      ],
      edges: [],
    };
    const { subject } = await createItem({
      name: 'Sunset Mood', kind: 'moodboard', space: 'library', by: 'user', graph, draft: false,
    });

    const doc = await libraryToDesigner(s1, subject.id);
    expect([doc.width, doc.height].every((v) => v > 0 && v <= 4096)).toBe(true);
    const rasters = doc.layers.filter((l): l is RasterLayer => l.type === 'raster');
    const texts = doc.layers.filter((l): l is TextLayer => l.type === 'text');
    expect(rasters.map((l) => l.sourceAssetId)).toEqual(['img_a', 'img_b']);
    expect(rasters[0].width / rasters[0].height).toBeCloseTo(16 / 9, 1);
    expect(rasters[1].x).toBeGreaterThanOrEqual(rasters[0].x + rasters[0].width - 1);
    for (const l of rasters) expect(l.x >= 0 && l.y >= 0 && l.x + l.width <= doc.width && l.y + l.height <= doc.height).toBe(true);
    expect(texts.every((t) => t.x >= 0 && t.x + t.width <= doc.width)).toBe(true);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('Warm golden light');

    // Also works in Studio (with studio view) and clamps oversized first image to 4096
    const big = mkAsset('img_big', s2, 6000, 3000);
    putImageBlob('img_big', 6000, 3000);
    useStore.setState((st) => ({ assets: { ...st.assets, img_big: big } }));
    const { subject: mb2 } = await createItem({
      name: 'Big Board', kind: 'moodboard', space: 'library', by: 'user', draft: false,
      graph: { nodes: [{ id: 'nb', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Big', assetId: 'img_big' } }], edges: [] },
    });
    const studioDoc = await libraryToStudio(s1, mb2.id);
    expect(studioDoc.library?.view).toBe('studio');
    expect([studioDoc.width, studioDoc.height]).toEqual([4096, 2048]);
    expect(studioDoc.layers.filter((l) => l.type === 'raster')).toHaveLength(1);
  });

  it('keeps entry and remaining layers intact when one image fails, and refreshes when moodboard grows', async () => {
    const [s1, s2] = Object.keys(useStore.getState().sessions);
    const bad = mkAsset('img_bad', s2, 800, 600);
    const ok = mkAsset('img_ok', s2, 800, 600);
    // img_bad has no blob -> assetCanvas throws; img_ok has valid blob
    putImageBlob('img_ok', 800, 600);
    useStore.setState({ assets: { img_bad: bad, img_ok: ok } });

    const { subject } = await createItem({
      name: 'Resilient Board', kind: 'moodboard', space: 'library', by: 'user', draft: false,
      graph: {
        nodes: [
          { id: 'n_bad', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Missing', assetId: 'img_bad' } },
          { id: 'n_ok', position: { x: 100, y: 0 }, data: { kind: 'asset', title: 'Valid', assetId: 'img_ok' } },
          { id: 'n_txt', position: { x: 200, y: 0 }, data: { kind: 'text', title: 'Caption', text: 'Still here' } },
        ],
        edges: [],
      },
    });

    const doc = await libraryToDesigner(s1, subject.id);
    expect(useStore.getState().library.some((s) => s.id === subject.id)).toBe(true);
    const rasters = doc.layers.filter((l): l is RasterLayer => l.type === 'raster');
    const texts = doc.layers.filter((l): l is TextLayer => l.type === 'text');
    expect(rasters.map((l) => l.sourceAssetId)).toEqual(['img_ok']);
    expect(texts.map((l) => l.text)).toEqual(['Still here']);

    // Adding another image to the graph-only moodboard and reopening refreshes instead of reusing stale doc
    const a3 = mkAsset('img_3', s2, 600, 600);
    putImageBlob('img_3', 600, 600);
    useStore.setState((st) => ({ assets: { ...st.assets, img_3: a3 } }));
    await saveItem({
      subjectId: subject.id, mode: 'overwrite', space: 'library', by: 'user',
      graph: {
        nodes: [
          { id: 'n_ok', position: { x: 100, y: 0 }, data: { kind: 'asset', title: 'Valid', assetId: 'img_ok' } },
          { id: 'n_3', position: { x: 300, y: 0 }, data: { kind: 'asset', title: 'Added', assetId: 'img_3' } },
        ],
        edges: [],
      },
    });
    const reopened = await libraryToDesigner(s1, subject.id);
    expect(reopened.id).toBe(doc.id);
    expect(reopened.layers.filter((l): l is RasterLayer => l.type === 'raster').map((l) => l.sourceAssetId)).toEqual(['img_ok', 'img_3']);
  });
});
