import { expect, it } from 'vitest';
import { asset, graphOf, hoisted, mkAsset, putImageBlob, resetStore } from './library-kits-final-fixtures';
import { saveAssetEdit, normalizeAssetRevisions } from '../src/engine/assetRevisions';
import { nodesToLibrary, libraryToNodes } from '../src/engine/flow/fromLibrary';
import { createItem, readKitVersion, restoreItemVersion } from '../src/engine/libraryVersions';
import type { Graph } from '../src/engine/types';
import { useStore } from '../src/store/store';

const paint = (id: string, contents: string) => saveAssetEdit(id, new Blob([contents], { type: 'image/png' }), 'original', { width: 800, height: 600 });
const ids = (graph: Graph | undefined) => graph?.nodes.flatMap(n => n.data.kind === 'asset' ? [n.data.assetId] : []);

it('restores the saved revision of an image with legacy originalRevision metadata', async () => {
  const s = resetStore();
  const a = mkAsset('a', s.id);
  const original = { assetId: 'original', width: a.width, height: a.height, mime: a.mime, createdAt: a.createdAt };
  useStore.setState({ assets: { a: { ...a, originalRevision: original } } });
  putImageBlob('original');
  putImageBlob('a');
  const { subject } = await createItem({ name: 'Legacy', kind: 'moodboard', space: 'library', by: 'user', graph: graphOf(asset('a', 100, 100)) });
  expect((await readKitVersion(subject.versionId!))?.revs).toEqual({ a: 1 });
  expect(await paint('a', 'img:new')).not.toBeNull();

  const revisions = normalizeAssetRevisions(useStore.getState().assets.a);
  expect(revisions.index).toBe(2);
  expect(revisions.versions[0].assetId).toBe('original');
  const restored = await restoreItemVersion({ subjectId: subject.id, versionId: subject.versionId!, space: 'library', by: 'user' });
  const [copy] = ids(restored.graph)!;
  expect(copy).not.toBe('a');
  expect(await hoisted.assetBlobs.get(copy!)?.text()).toBe('img:a');
  expect(await hoisted.assetBlobs.get('a')?.text()).toBe('img:new');
});

it('keeps a video node live while restoring the image revision in the same graph', async () => {
  const s = resetStore();
  const v = { ...mkAsset('v', s.id), kind: 'video' as const, mime: 'video/mp4' };
  const assets = { a: mkAsset('a', s.id), v: { ...v, revisionIndex: 1, revisions: [
    { assetId: 'old-video', width: v.width, height: v.height, mime: v.mime, createdAt: 1 },
    { assetId: v.id, width: v.width, height: v.height, mime: v.mime, createdAt: 2 },
  ] } };
  useStore.setState({ assets });
  putImageBlob('a');
  expect(await paint('a', 'img:saved')).not.toBeNull();
  const { subject } = await createItem({ name: 'Mixed', kind: 'moodboard', space: 'library', by: 'user', graph: graphOf(asset('a', 100, 100), asset('v', 400, 400)) });
  expect((await readKitVersion(subject.versionId!))?.revs).toEqual({ a: 1 });
  expect(await paint('a', 'img:new')).not.toBeNull();
  const restored = await restoreItemVersion({ subjectId: subject.id, versionId: subject.versionId!, space: 'library', by: 'user' });
  const [copy, video] = ids(restored.graph)!;
  expect(await hoisted.assetBlobs.get(copy!)?.text()).toBe('img:saved');
  expect(video).toBe('v');
  expect(useStore.getState().assets.v).toBe(assets.v);
  expect(ids({ nodes: libraryToNodes(s.id, subject.id).added, edges: [] })).toEqual([copy, 'v']);
});

it('restores a version in a Nodes Save a copy entry without changing the source entry', async () => {
  const s = resetStore();
  useStore.setState({ assets: { a: mkAsset('a', s.id) } });
  putImageBlob('a');
  const { subject } = await createItem({ name: 'Source', kind: 'moodboard', space: 'library', by: 'user', graph: graphOf(asset('a', 100, 100)) });
  const { groupId } = libraryToNodes(s.id, subject.id);
  expect(await paint('a', 'img:copy-version')).not.toBeNull();
  const copy = await nodesToLibrary({ sessionId: s.id, subjectId: subject.id, groupId: groupId!, mode: 'copy' });
  expect(copy).toMatchObject({ copiedFrom: subject.id });
  expect((await readKitVersion(copy.versionId!))?.revs).toEqual({ a: 1 });
  expect(await paint('a', 'img:later')).not.toBeNull();
  const restored = await restoreItemVersion({ subjectId: copy.id, versionId: copy.versionId!, space: 'library', by: 'user' });
  const [restoredAsset] = ids(restored.graph)!;
  expect(restored.id).toBe(copy.id);
  expect(restored.versionId).not.toBe(copy.versionId);
  expect(await hoisted.assetBlobs.get(restoredAsset!)?.text()).toBe('img:copy-version');
  expect(useStore.getState().library.find(item => item.id === subject.id)).toEqual(subject);
  expect(await hoisted.assetBlobs.get('a')?.text()).toBe('img:later');
});
