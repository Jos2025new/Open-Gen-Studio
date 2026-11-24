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
      async set(key: string, value: Blob): Promise<void> {
        const err = failSetAt?.(key);
        if (err) throw err;
        blobs.set(key, value);
      },
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
import { createKit, readKitVersion, saveKit, updateKit, waitKitQueue } from '../src/engine/libraryVersions';
import { deleteSubject } from '../src/engine/libraryActions';
import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc, newRasterLayer, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { groupLayers, patchGroup } from '../src/engine/design/groups';
import { historyDepth } from '../src/engine/design/history';
import { createSession, setDoc, useStore } from '../src/store/store';
import { run, setApprover } from '../src/engine/commands';
import type { RasterLayer, TextLayer, VectorLayer } from '../src/engine/types';

async function blobBytes(b: Blob | undefined): Promise<Uint8Array> {
  return b ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array();
}

function resetStore() {
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  return s;
}

beforeEach(() => {
  hoisted.blobs.clear();
  hoisted.setFailSet(null);
  setApprover(null);
});

describe('Part 3: insertComponent with origin (copy, own pixels, single undo, no live link) & library.kit.insert', () => {
  it('copies group layers with own ids/pixels, positions at `at`, records origin `from`, undoes in 1 step, and stays decoupled from kit updates/delete', async () => {
    const s = resetStore();
    const { subject: kit, doc: kitDoc } = await createKit({ name: 'UIKit', kind: 'design-system', space: 'studio', sessionId: s.id, by: 'user' });
    const bg = newVectorLayer('Bg', [{ type: 'rect', x: 100, y: 50, w: 160, h: 48, fill: '#2255ff', stroke: null, strokeWidth: 0, radius: 8 }]);
    const icon: RasterLayer = { ...newRasterLayer('Icon', { x: 112, y: 62, width: 24, height: 24 }, { width: 24, height: 24 }), rev: 1, paintBaseId: 'pb_icon' };
    const lbl = newTextLayer('Label', 'Start', { x: 144, y: 64, width: 100 });
    setDoc(s.id, kitDoc!.id, (d) => ({ ...d, layers: [bg, icon, lbl] }));
    const iconPx = new Uint8Array([7, 14, 21, 28]);
    const basePx = new Uint8Array([1, 2, 3, 4]);
    hoisted.blobs.set(`raster:${icon.id}`, new Blob([iconPx], { type: 'image/png' }));
    hoisted.blobs.set('raster:pb_icon', new Blob([basePx], { type: 'image/png' }));

    const srcGid = groupLayers(s.id, kitDoc!.id, [bg.id, icon.id, lbl.id])!;
    patchGroup(s.id, kitDoc!.id, srcGid, { name: 'CTA Button' });

    const v1 = await saveKit({
      subjectId: kit.id, mode: 'overwrite', sessionId: s.id, space: 'studio', by: 'user',
      pieces: [{ id: 'comp_cta', kind: 'component', groupId: srcGid, name: 'CTA Button', role: 'cta' }],
    });
    const v1Snap = await readKitVersion(v1.versionId!);
    const v1Raster = v1Snap!.doc!.layers.find((l) => l.type === 'raster') as RasterLayer;

    // Target document (empty)
    const target = createDoc('Landing', 1200, 800, '#ffffff');
    addDoc(s.id, target);

    // Insert via library.kit.insert with `at: { x: 20, y: 30 }`
    const insRes = await run({
      cmd: 'library.kit.insert',
      on: { session: s.id, doc: target.id },
      args: { id: kit.id, piece: 'comp_cta', at: { x: 20, y: 30 } },
    }, { caller: 'agent' });
    expect(insRes.ok, JSON.stringify(insRes)).toBe(true);
    const { groupId, layerIds } = insRes.results[0] as { groupId: string; layerIds: string[] };
    expect(groupId).not.toBe(srcGid);
    expect(layerIds).toHaveLength(3);

    const after = getDoc(s.id, target.id)!;
    const grp = after.groups?.find((g) => g.id === groupId);
    expect(grp).toMatchObject({
      id: groupId,
      name: 'CTA Button',
      from: { subjectId: kit.id, pieceId: 'comp_cta', versionId: v1.versionId },
    });
    expect(after.layers).toHaveLength(3);
    expect(after.layers.every((l) => l.groupId === groupId)).toBe(true);

    // Own IDs and own pixel blobs (exact bytes, different keys from kit's version!)
    const insVec = after.layers[0] as VectorLayer;
    const insRaster = after.layers[1] as RasterLayer;
    const insText = after.layers[2] as TextLayer;
    expect(insRaster.id).not.toBe(v1Raster.id);
    expect(insRaster.paintBaseId).toBeTruthy();
    expect(insRaster.paintBaseId).not.toBe(v1Raster.paintBaseId);
    expect(insVec.shapes[0].id).not.toBe(bg.shapes[0].id);
    expect(await blobBytes(hoisted.blobs.get(`raster:${insRaster.id}`))).toEqual(iconPx);
    expect(await blobBytes(hoisted.blobs.get(`raster:${insRaster.paintBaseId}`))).toEqual(basePx);

    // Positioned at `at` (original min x=100, y=50 -> shifted by dx=-80, dy=-20)
    expect(insVec.shapes[0].x).toBe(20);
    expect(insVec.shapes[0].y).toBe(30);
    expect(insRaster.x).toBe(32);
    expect(insRaster.y).toBe(42);
    expect(insText.x).toBe(64);
    expect(insText.y).toBe(44);

    // Single undo step removes all 3 layers and the group
    expect(historyDepth(target.id).undo).toBe(1);
    undoDoc(s.id, target.id);
    expect(getDoc(s.id, target.id)!.layers).toEqual([]);

    // Re-insert directly via insertComponent, then mutate kit to v2 AND delete kit -> inserted copy is untouched!
    const direct = await insertComponent(s.id, target.id, kit.id, 'comp_cta');
    const keptRaster = getDoc(s.id, target.id)!.layers.find((l) => l.type === 'raster') as RasterLayer;
    setDoc(s.id, kitDoc!.id, (d) => ({ ...d, layers: d.layers.map((l) => (l.type === 'text' ? { ...l, text: 'CHANGED V2' } : l)) }));
    await saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, space: 'studio', by: 'user' });
    deleteSubject(kit.id);
    await waitKitQueue(kit.id);

    const stillThere = getDoc(s.id, target.id)!;
    expect(stillThere.groups?.find((g) => g.id === direct.groupId)?.from?.versionId).toBe(v1.versionId);
    expect((stillThere.layers.find((l) => l.type === 'text') as TextLayer).text).toBe('Start');
    expect(await blobBytes(hoisted.blobs.get(`raster:${keptRaster.id}`))).toEqual(iconPx);
  });

  it('rejects missing/non-component piece or missing group and cleans up blobs on write failure', async () => {
    const s = resetStore();
    const { subject: kit, doc: kitDoc } = await createKit({ name: 'ErrKit', kind: 'design-system', space: 'studio', sessionId: s.id, by: 'user' });
    const r: RasterLayer = { ...newRasterLayer('Img', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), rev: 1 };
    const t = newTextLayer('T', 'Hi', { x: 0, y: 0, width: 50 });
    setDoc(s.id, kitDoc!.id, (d) => ({ ...d, layers: [r, t] }));
    hoisted.blobs.set(`raster:${r.id}`, new Blob([new Uint8Array([5, 6])], { type: 'image/png' }));
    const gid = groupLayers(s.id, kitDoc!.id, [r.id, t.id])!;
    await saveKit({
      subjectId: kit.id, mode: 'overwrite', sessionId: s.id, space: 'studio', by: 'user',
      pieces: [
        { id: 'c_ok', kind: 'component', groupId: gid, name: 'Ok' },
        { id: 'c_missing_grp', kind: 'component', groupId: 'grp_nope', name: 'Missing' },
        { id: 't_only', kind: 'text', text: 'Not a component' },
      ],
    });
    const target = createDoc('Target', 400, 400);
    addDoc(s.id, target);

    await expect(insertComponent(s.id, target.id, kit.id, 'nope')).rejects.toThrow(/piece/i);
    await expect(insertComponent(s.id, target.id, kit.id, 't_only')).rejects.toThrow(/component/i);
    await expect(insertComponent(s.id, target.id, kit.id, 'c_missing_grp')).rejects.toThrow(/group/i);

    // Pixel write failure cleans up partial blobs and leaves target untouched
    const beforeKeys = new Set(hoisted.blobs.keys());
    hoisted.setFailSet(() => new Error('disk full'));
    await expect(insertComponent(s.id, target.id, kit.id, 'c_ok')).rejects.toThrow(/disk full/i);
    hoisted.setFailSet(null);
    expect([...hoisted.blobs.keys()].filter((k) => !beforeKeys.has(k))).toEqual([]);
    expect(getDoc(s.id, target.id)!.layers).toEqual([]);
  });
});
