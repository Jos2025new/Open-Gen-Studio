import { expect, it } from 'vitest';
import { asset, graphOf, hoisted, mkAsset, notesOf, putImageBlob, resetStore, text } from './library-kits-final-fixtures';
import { addTextLayer, getDoc, patchLayer, undoDoc } from '../src/engine/design/actions';
import { saveAssetEdit } from '../src/engine/assetRevisions';
import { createItem, libraryToDesigner, restoreItemVersion, saveItem } from '../src/engine/libraryVersions';
import { getBuffer } from '../src/engine/design/raster';
import { libraryToNodes, nodesToLibrary } from '../src/engine/flow/fromLibrary';
import { editCompound } from '../src/engine/nodecore/edit';
import { newFxLayer, newFxOp } from '../src/engine/fx/fxCommands';
import { setDoc, useStore } from '../src/store/store';

it('reopens a restored graph-only board with the saved image pixels in its linked layer', async () => {
  const s = resetStore();
  useStore.setState({ assets: { a: mkAsset('a', s.id) } });
  putImageBlob('a');
  const graph = graphOf(asset('a', 100, 100));
  const { subject } = await createItem({ name: 'Image', kind: 'moodboard', space: 'library', by: 'user', graph });
  expect(subject.docRev).toBeUndefined();
  const painted = new Blob(['img:painted'], { type: 'image/png' });
  hoisted.dims.set(painted, { w: 320, h: 600 });
  expect(await saveAssetEdit('a', painted, 'original', { width: 320, height: 600 })).not.toBeNull();
  const doc = await libraryToDesigner(s.id, subject.id);
  const initial = doc.layers[0];
  patchLayer(s.id, doc.id, initial.id, { x: 25, y: 40, width: 240, height: 460, opacity: 0.5, transform: [0, 1, -1, 0, 0, 0] });
  const fx = newFxLayer('filter', { scope: 'layer', ops: [newFxOp('blur', { radius: 4 })] });
  setDoc(s.id, doc.id, d => ({ ...d, layers: [...d.layers, fx] }));
  const layer = getDoc(s.id, doc.id)!.layers[0];
  const oldPixels = getBuffer(layer.id);
  expect(layer).toMatchObject({ sourceAssetId: 'a', pxWidth: 320 });

  const restored = await restoreItemVersion({ subjectId: subject.id, versionId: subject.versionId!, space: 'library', by: 'user' });
  const node = restored.graph!.nodes[0].data;
  if (node.kind !== 'asset' || !node.assetId) throw new Error('Missing restored asset');
  expect(await hoisted.assetBlobs.get(node.assetId)?.text()).toBe('img:a');
  hoisted.dims.set(hoisted.assetBlobs.get(node.assetId)!, { w: 800, h: 600 });
  const reopened = await libraryToDesigner(s.id, subject.id);
  expect(reopened.id).toBe(doc.id);
  expect(reopened.layers).toEqual([expect.objectContaining({
    id: layer.id, sourceAssetId: node.assetId, pxWidth: 800, x: 25, y: 40, width: 240, height: 460,
    opacity: 0.5, transform: [0, 1, -1, 0, 0, 0],
  }), fx]);
  expect(getBuffer(layer.id)?.width).toBe(800);
  undoDoc(s.id, doc.id);
  expect(getDoc(s.id, doc.id)!.layers).toEqual([layer, fx]);
  expect(getBuffer(layer.id)?.width).toBe(oldPixels?.width);
  const openedAgain = await libraryToDesigner(s.id, subject.id);
  expect(openedAgain.layers[0]).toMatchObject({ id: layer.id, sourceAssetId: node.assetId, pxWidth: 800 });
  expect(getBuffer(layer.id)?.width).toBe(800);
});

it('undoes a new library image without removing a text layer added during loading', async () => {
  const s = resetStore();
  useStore.setState({ assets: { c: mkAsset('c', s.id) } });
  putImageBlob('c');
  const a = text('a', 'A', 100, 100);
  const { subject } = await createItem({ name: 'Race', kind: 'moodboard', space: 'library', by: 'user', graph: graphOf(a) });
  const doc = await libraryToDesigner(s.id, subject.id);
  await saveItem({ subjectId: subject.id, mode: 'overwrite', space: 'library', by: 'user', graph: graphOf(a, asset('c', 400, 400)) });
  let unblock!: () => void, started!: () => void;
  const loading = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  hoisted.setOnGetAsset(id => { if (id === 'c') { started(); return blocked; } });
  const opening = libraryToDesigner(s.id, subject.id);
  await loading;
  addTextLayer(s.id, doc.id, 'Own', { x: 30, y: 30, width: 200, height: 60 });
  unblock();
  await opening;
  expect(getDoc(s.id, doc.id)!.layers.some(l => l.type === 'raster' && l.sourceAssetId === 'c')).toBe(true);
  undoDoc(s.id, doc.id);
  expect(notesOf(s.id, doc.id)).toEqual(['A', 'Own']);
  expect(getDoc(s.id, doc.id)!.layers.some(l => l.type === 'raster')).toBe(false);
  undoDoc(s.id, doc.id);
  expect(notesOf(s.id, doc.id)).toEqual(['A']);
});

it.each(['untouched', 'direct paint', 'paint base', 'locked'] as const)('handles a Nodes image change when the linked layer is %s', async (state) => {
  const s = resetStore();
  useStore.setState({ assets: { a: mkAsset('a', s.id), b: mkAsset('b', s.id, 400, 300), c: mkAsset('c', s.id, 200, 150) } });
  putImageBlob('a');
  putImageBlob('b', 400, 300);
  putImageBlob('c', 200, 150);
  const { subject } = await createItem({ name: 'Image', kind: 'moodboard', space: 'library', by: 'user', graph: graphOf(asset('a', 100, 100)) });
  const doc = await libraryToDesigner(s.id, subject.id);
  const id = doc.layers[0].id;
  if (state === 'direct paint') patchLayer(s.id, doc.id, id, { rev: 1 });
  if (state === 'paint base') patchLayer(s.id, doc.id, id, { paintBaseId: 'base' });
  if (state === 'locked') patchLayer(s.id, doc.id, id, { locked: true });
  const before = getDoc(s.id, doc.id)!.layers[0];
  const { groupId, added } = libraryToNodes(s.id, subject.id);
  for (const assetId of ['b', 'c']) {
    expect(editCompound(s.id, 'fixture-image-change', g => ({
      ...g, nodes: g.nodes.map(n => n.id === added[0].id ? { ...n, data: { kind: 'asset', title: 'Image', assetId } } : n),
    }))).toBeNull();
    await nodesToLibrary({ sessionId: s.id, subjectId: subject.id, groupId: groupId!, mode: 'overwrite' });
    const reopened = await libraryToDesigner(s.id, subject.id);
    expect(reopened.layers).toHaveLength(1);
    if (state === 'untouched') {
      expect(reopened.layers[0]).toMatchObject({ id, sourceAssetId: assetId });
      expect(getBuffer(id)?.width).toBe(assetId === 'b' ? 400 : 200);
    } else {
      expect(reopened.layers[0]).toEqual(before);
      expect(getBuffer(id)?.width).toBe(800);
      expect(useStore.getState().ui.toasts.at(-1)?.text).toContain('Kept');
    }
  }
});
