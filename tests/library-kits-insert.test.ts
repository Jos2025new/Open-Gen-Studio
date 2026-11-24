import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  let failSetAt: ((key: string) => Error | null) | null = null;
  return {
    blobs,
    setFailSet: (fn: ((key: string) => Error | null) | null) => { failSetAt = fn; },
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> { const err = failSetAt?.(key); if (err) throw err; blobs.set(key, value); },
      async del(key: string): Promise<void> { blobs.delete(key); },
      async delMany(keys: string[]): Promise<void> { for (const k of keys) blobs.delete(k); },
    },
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: hoisted.blobDb,
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { insertComponent } from '../src/engine/libraryInsert';
import { createItem, readKitVersion, saveItem, waitKitQueue } from '../src/engine/libraryVersions';
import { deleteSubject } from '../src/engine/libraryActions';
import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc, newRasterLayer, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { groupLayers, patchGroup } from '../src/engine/design/groups';
import { historyDepth } from '../src/engine/design/history';
import { createSession, setDoc, useStore } from '../src/store/store';
import type { RasterLayer, TextLayer, VectorLayer } from '../src/engine/types';

async function blobBytes(b: Blob | undefined): Promise<Uint8Array> {
  return b ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array();
}

function resetStore() {
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  return s;
}

beforeEach(() => { hoisted.blobs.clear(); hoisted.setFailSet(null); });

describe('insertComponent with origin (copy, own pixels, single undo, no live link)', () => {
  it('copies group layers with own ids/pixels, positions at `at`, records origin `from`, undoes in 1 step, and stays decoupled from kit updates/delete', async () => {
    const s = resetStore();
    const { subject: kit, doc: kitDoc } = await createItem({ name: 'UIKit', kind: 'design-system', space: 'studio', sessionId: s.id, by: 'user' });
    const bg = newVectorLayer('Bg', [{ type: 'rect', x: 100, y: 50, w: 160, h: 48, fill: '#2255ff', stroke: null, strokeWidth: 0, radius: 8 }]);
    const icon: RasterLayer = { ...newRasterLayer('Icon', { x: 112, y: 62, width: 24, height: 24 }, { width: 24, height: 24 }), rev: 1, paintBaseId: 'pb_icon' };
    const lbl = newTextLayer('Label', 'Start', { x: 144, y: 64, width: 100 });
    setDoc(s.id, kitDoc!.id, (d) => ({ ...d, layers: [bg, icon, lbl] }));
    const iconPx = new Uint8Array([7, 14, 21, 28]), basePx = new Uint8Array([1, 2, 3, 4]);
    hoisted.blobs.set(`raster:${icon.id}`, new Blob([iconPx], { type: 'image/png' }));
    hoisted.blobs.set('raster:pb_icon', new Blob([basePx], { type: 'image/png' }));

    const srcGid = groupLayers(s.id, kitDoc!.id, [bg.id, icon.id, lbl.id])!;
    patchGroup(s.id, kitDoc!.id, srcGid, { name: 'CTA Button' });

    const v1 = await saveItem({
      subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: kitDoc!.id, space: 'studio', by: 'user',
      graph: { nodes: [{ id: 'comp_cta', position: { x: 0, y: 0 }, data: { kind: 'part', partKind: 'component', groupId: srcGid, title: 'CTA Button', role: 'cta' } }], edges: [] },
    });
    const v1Raster = (await readKitVersion(v1.versionId!))!.doc!.layers.find((l) => l.type === 'raster') as RasterLayer;

    const target = createDoc('Landing', 1200, 800, '#ffffff');
    addDoc(s.id, target);

    const { groupId, layerIds } = await insertComponent(s.id, target.id, kit.id, 'comp_cta', { x: 20, y: 30 });
    expect(groupId).not.toBe(srcGid);
    expect(layerIds).toHaveLength(3);

    const after = getDoc(s.id, target.id)!;
    expect(after.groups?.find((g) => g.id === groupId)).toMatchObject({ id: groupId, name: 'CTA Button', from: { subjectId: kit.id, pieceId: 'comp_cta', versionId: v1.versionId } });
    const insVec = after.layers[0] as VectorLayer, insRaster = after.layers[1] as RasterLayer, insText = after.layers[2] as TextLayer;
    expect(insRaster.id).not.toBe(v1Raster.id);
    expect(insRaster.paintBaseId).not.toBe(v1Raster.paintBaseId);
    expect(await blobBytes(hoisted.blobs.get(`raster:${insRaster.id}`))).toEqual(iconPx);
    expect(await blobBytes(hoisted.blobs.get(`raster:${insRaster.paintBaseId}`))).toEqual(basePx);
    expect([insVec.shapes[0].x, insVec.shapes[0].y, insRaster.x, insRaster.y, insText.x, insText.y]).toEqual([20, 30, 32, 42, 64, 44]);

    expect(historyDepth(target.id).undo).toBe(1);
    undoDoc(s.id, target.id);
    expect(getDoc(s.id, target.id)!.layers).toEqual([]);

    const direct = await insertComponent(s.id, target.id, kit.id, 'comp_cta');
    const keptRaster = getDoc(s.id, target.id)!.layers.find((l) => l.type === 'raster') as RasterLayer;
    setDoc(s.id, kitDoc!.id, (d) => ({ ...d, layers: d.layers.map((l) => (l.type === 'text' ? { ...l, text: 'CHANGED V2' } : l)) }));
    await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: kitDoc!.id, space: 'studio', by: 'user' });
    deleteSubject(kit.id);
    await waitKitQueue(kit.id);

    const stillThere = getDoc(s.id, target.id)!;
    expect(stillThere.groups?.find((g) => g.id === direct.groupId)?.from?.versionId).toBe(v1.versionId);
    expect((stillThere.layers.find((l) => l.type === 'text') as TextLayer).text).toBe('Start');
    expect(await blobBytes(hoisted.blobs.get(`raster:${keptRaster.id}`))).toEqual(iconPx);
  });

  it('rejects missing/non-component node or missing group and cleans up blobs on write failure', async () => {
    const s = resetStore();
    const { subject: kit, doc: kitDoc } = await createItem({ name: 'ErrKit', kind: 'design-system', space: 'studio', sessionId: s.id, by: 'user' });
    const r: RasterLayer = { ...newRasterLayer('Img', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), rev: 1 };
    const t = newTextLayer('T', 'Hi', { x: 0, y: 0, width: 50 });
    setDoc(s.id, kitDoc!.id, (d) => ({ ...d, layers: [r, t] }));
    hoisted.blobs.set(`raster:${r.id}`, new Blob([new Uint8Array([5, 6])], { type: 'image/png' }));
    const gid = groupLayers(s.id, kitDoc!.id, [r.id, t.id])!;
    await saveItem({
      subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: kitDoc!.id, space: 'studio', by: 'user',
      graph: {
        nodes: [
          { id: 'c_ok', position: { x: 0, y: 0 }, data: { kind: 'part', partKind: 'component', groupId: gid, title: 'Ok' } },
          { id: 'c_missing_grp', position: { x: 0, y: 0 }, data: { kind: 'part', partKind: 'component', groupId: 'grp_nope', title: 'Missing' } },
          { id: 't_only', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'T', text: 'Not a component' } },
        ],
        edges: [],
      },
    });
    const target = createDoc('Target', 400, 400);
    addDoc(s.id, target);

    await expect(insertComponent(s.id, target.id, kit.id, 'nope')).rejects.toThrow(/piece/i);
    await expect(insertComponent(s.id, target.id, kit.id, 't_only')).rejects.toThrow(/component/i);
    await expect(insertComponent(s.id, target.id, kit.id, 'c_missing_grp')).rejects.toThrow(/group/i);

    const beforeKeys = new Set(hoisted.blobs.keys());
    hoisted.setFailSet(() => new Error('disk full'));
    await expect(insertComponent(s.id, target.id, kit.id, 'c_ok')).rejects.toThrow(/disk full/i);
    hoisted.setFailSet(null);
    expect([...hoisted.blobs.keys()].filter((k) => !beforeKeys.has(k))).toEqual([]);
    expect(getDoc(s.id, target.id)!.layers).toEqual([]);
  });
});
