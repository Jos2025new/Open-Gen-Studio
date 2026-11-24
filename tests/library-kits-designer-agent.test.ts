import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined, delMany: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { run } from '../src/engine/commands';
import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc, newRasterLayer } from '../src/engine/design/doc';
import { historyDepth } from '../src/engine/design/history';
import { createSession, setDoc, useStore } from '../src/store/store';
import type { RasterLayer, TextLayer } from '../src/engine/types';

let sid: string;

beforeEach(() => {
  const s = createSession('S1');
  sid = s.id;
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
});

describe('Part 4: Designer group commands, enriched doc.read, doc.new background, layer.set x/y/style', () => {
  it('supports designer.doc.new with background, designer.group.create/rename/ungroup, and enriched designer.doc.read', async () => {
    // 1) designer.doc.new accepts background
    const created = await run({
      cmd: 'designer.doc.new',
      on: { session: sid },
      args: { width: 1200, height: 800, name: 'Board', background: '#101418' },
    }, { caller: 'agent' });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    const { doc: docId } = created.results[0] as { doc: string };
    expect(getDoc(sid, docId)?.background).toBe('#101418');

    // Also supports explicit null background
    const transparent = await run({
      cmd: 'designer.doc.new',
      on: { session: sid },
      args: { width: 400, height: 400, background: null },
    }, { caller: 'agent' });
    expect(transparent.ok).toBe(true);
    expect(getDoc(sid, (transparent.results[0] as { doc: string }).doc)?.background).toBeNull();

    // 2) Add vector + text layers, group with custom name, rename, read, ungroup, undo
    const seq = await run({
      on: { session: sid, doc: docId },
      seq: [
        { cmd: 'designer.layer.add_shapes', args: { name: 'Bg', shapes: [{ type: 'rect', x: 40, y: 50, w: 200, h: 60, fill: '#2255ff' }] } },
        { cmd: 'designer.layer.add_text', args: { name: 'Title', text: 'Buy Now', x: 60, y: 65, width: 160, style: { color: '#ffffff', fontSize: 20 } } },
        { cmd: 'designer.group.create', args: { layers: ['$1.layer', '$2.layer'], name: 'Button' } },
        { cmd: 'designer.group.rename', args: { group: '$3.group', name: 'Primary CTA' } },
        { cmd: 'designer.doc.read' },
      ],
    }, { caller: 'agent' });
    expect(seq.ok, JSON.stringify(seq)).toBe(true);
    const gid = (seq.results[2] as { group: string }).group;
    const read = seq.results[4] as {
      background: string | null;
      groups: Array<{ id: string; name: string }>;
      layers: Array<{ id: string; type: string; group?: string; box?: { x: number; y: number; w: number; h: number }; text?: string; color?: string }>;
    };
    expect(read.background).toBe('#101418');
    expect(read.groups).toEqual([{ id: gid, name: 'Primary CTA' }]);
    expect(read.layers[0]).toMatchObject({ type: 'vector', group: gid, box: { x: 40, y: 50, w: 200, h: 60 }, color: '#2255ff' });
    expect(read.layers[1]).toMatchObject({ type: 'text', group: gid, text: 'Buy Now', color: '#ffffff' });
    expect(read.layers[1].box).toMatchObject({ x: 60, y: 65, w: 160 });

    // Ungroup works and is undoable
    const un = await run({ cmd: 'designer.group.ungroup', on: { session: sid, doc: docId }, args: { group: gid } }, { caller: 'agent' });
    expect(un.ok).toBe(true);
    expect(getDoc(sid, docId)?.groups).toEqual([]);
    expect(getDoc(sid, docId)?.layers.every((l) => !l.groupId)).toBe(true);
    expect(historyDepth(docId).undo).toBe(2);
    undoDoc(sid, docId);
    expect(getDoc(sid, docId)?.groups).toEqual([{ id: gid, name: 'Primary CTA' }]);

    // Missing group rejected clearly
    expect(await run({ cmd: 'designer.group.rename', on: { session: sid, doc: docId }, args: { group: 'grp_missing', name: 'X' } }, { caller: 'agent' })).toMatchObject({ ok: false });
    expect(await run({ cmd: 'designer.group.ungroup', on: { session: sid, doc: docId }, args: { group: 'grp_missing' } }, { caller: 'agent' })).toMatchObject({ ok: false });
  });

  it('designer.layer.set accepts x, y, and text style fields supported by patchLayer, rejecting incompatible layer types', async () => {
    const doc = createDoc('SetDoc', 800, 600);
    const raster: RasterLayer = newRasterLayer('Img', { x: 0, y: 0, width: 100, height: 100 }, { width: 100, height: 100 });
    addDoc(sid, { ...doc, layers: [raster], activeLayerId: raster.id });

    // Add text + vector
    const setup = await run({
      on: { session: sid, doc: doc.id },
      seq: [
        { cmd: 'designer.layer.add_text', args: { text: 'Hello', x: 10, y: 20, width: 120 } },
        { cmd: 'designer.layer.add_shapes', args: { shapes: [{ type: 'rect', x: 0, y: 0, w: 50, h: 50, fill: '#000' }] } },
      ],
    }, { caller: 'agent' });
    expect(setup.ok).toBe(true);
    const textId = (setup.results[0] as { layer: string }).layer;
    const vecId = (setup.results[1] as { layer: string }).layer;

    // Move raster with x, y
    const moveRaster = await run({ cmd: 'designer.layer.set', on: { session: sid, doc: doc.id }, args: { layer: raster.id, x: 45, y: 75 } }, { caller: 'agent' });
    expect(moveRaster.ok, JSON.stringify(moveRaster)).toBe(true);
    const updatedRaster = getDoc(sid, doc.id)!.layers.find((l) => l.id === raster.id) as RasterLayer;
    expect([updatedRaster.x, updatedRaster.y]).toEqual([45, 75]);

    // Update text x, y and text style
    const setText = await run({
      cmd: 'designer.layer.set',
      on: { session: sid, doc: doc.id },
      args: { layer: textId, x: 120, y: 180, style: { fontFamily: 'Serif', fontSize: 36, fontWeight: 700, color: '#ff3366', align: 'center', lineHeight: 1.4, letterSpacing: 2 } },
    }, { caller: 'agent' });
    expect(setText.ok, JSON.stringify(setText)).toBe(true);
    const updatedText = getDoc(sid, doc.id)!.layers.find((l) => l.id === textId) as TextLayer;
    expect(updatedText).toMatchObject({ x: 120, y: 180, fontFamily: 'Serif', fontSize: 36, fontWeight: 700, color: '#ff3366', align: 'center', lineHeight: 1.4, letterSpacing: 2 });

    // Reject x/y on vector layer and style on raster layer
    expect(await run({ cmd: 'designer.layer.set', on: { session: sid, doc: doc.id }, args: { layer: vecId, x: 10 } }, { caller: 'agent' })).toMatchObject({ ok: false });
    expect(await run({ cmd: 'designer.layer.set', on: { session: sid, doc: doc.id }, args: { layer: raster.id, style: { fontSize: 20 } } }, { caller: 'agent' })).toMatchObject({ ok: false });
    // Strict schema rejects unknown fields
    expect(await run({ cmd: 'designer.layer.set', on: { session: sid, doc: doc.id }, args: { layer: textId, bogus: 1 } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    // Also verify doc.read shows raster pageFill color when set
    setDoc(sid, doc.id, (d) => ({ ...d, layers: d.layers.map((l) => (l.id === raster.id && l.type === 'raster' ? { ...l, pageFill: { color: '#00ffaa', rev: 1 } } : l)) }));
    const readRes = await run({ cmd: 'designer.doc.read', on: { session: sid, doc: doc.id } }, { caller: 'agent' });
    expect(readRes.ok).toBe(true);
    const layers = (readRes.results[0] as { layers: Array<{ id: string; color?: string }> }).layers;
    expect(layers.find((l) => l.id === raster.id)?.color).toBe('#00ffaa');
  });

  it('B1 review (b) & (c): designer.layer.set respects locked layers for x/y/style/text and designer.doc.new validates background color', async () => {
    // (c) designer.doc.new rejects invalid background color strings, accepts valid hex & null
    expect(await run({ cmd: 'designer.doc.new', on: { session: sid }, args: { width: 400, height: 400, background: 'not-a-color' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(await run({ cmd: 'designer.doc.new', on: { session: sid }, args: { width: 400, height: 400, background: '' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(await run({ cmd: 'designer.doc.new', on: { session: sid }, args: { width: 400, height: 400, background: '#112233aa' } }, { caller: 'agent' })).toMatchObject({ ok: true });

    // (b) designer.layer.set refuses x/y/style/text changes on a locked layer, while still allowing unlock
    const doc = createDoc('LockDoc', 400, 400);
    addDoc(sid, doc);
    const added = await run({ cmd: 'designer.layer.add_text', on: { session: sid, doc: doc.id }, args: { text: 'LockedTitle', x: 10, y: 20, width: 100 } }, { caller: 'agent' });
    const textId = (added.results[0] as { layer: string }).layer;
    expect((await run({ cmd: 'designer.layer.set', on: { session: sid, doc: doc.id }, args: { layer: textId, locked: true } }, { caller: 'agent' })).ok).toBe(true);

    expect(await run({ cmd: 'designer.layer.set', on: { session: sid, doc: doc.id }, args: { layer: textId, x: 99 } }, { caller: 'agent' })).toMatchObject({ ok: false });
    expect(await run({ cmd: 'designer.layer.set', on: { session: sid, doc: doc.id }, args: { layer: textId, style: { color: '#ff0000' } } }, { caller: 'agent' })).toMatchObject({ ok: false });
    expect((getDoc(sid, doc.id)!.layers.find((l) => l.id === textId) as TextLayer).x).toBe(10);

    // Unlocking works and then x/y/style succeeds
    expect((await run({ cmd: 'designer.layer.set', on: { session: sid, doc: doc.id }, args: { layer: textId, locked: false, x: 50 } }, { caller: 'agent' })).ok).toBe(true);
    expect((getDoc(sid, doc.id)!.layers.find((l) => l.id === textId) as TextLayer).x).toBe(50);
  });
});
