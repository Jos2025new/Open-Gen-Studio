import { expect, it, vi } from 'vitest';
import { asset, graphOf, hoisted, mkAsset, notesOf, putImageBlob, resetStore, text, tool } from './library-kits-final-fixtures';
import { createItem, libraryToDesigner, readKitVersion, restoreItemVersion, saveItem } from '../src/engine/libraryVersions';
import { addTextLayer, getDoc, undoDoc } from '../src/engine/design/actions';
import { useStore } from '../src/store/store';
import { deleteSession } from '../src/engine/actions';
import { run } from '../src/engine/commands';
import { normalizeAssetRevisions, redoAssetRevision, saveAssetEdit, undoAssetRevision } from '../src/engine/assetRevisions';
import { libraryToNodes } from '../src/engine/flow/fromLibrary';
import type { Graph, Layer } from '../src/engine/types';

it('opening a revision undoes its moves, additions and page growth together', async () => {
  const s = resetStore();
  const {subject} = await createItem({name:'Undo',kind:'moodboard',space:'library',by:'user',graph:graphOf(text('a','A',100,100),text('b','B',500,150))});
  const doc = await libraryToDesigner(s.id,subject.id), b = doc.layers[1] as Extract<Layer,{type:'text'}>;
  await saveItem({subjectId:subject.id,mode:'overwrite',space:'library',by:'user',graph:graphOf(text('a','A',100,100),text('b','B',540,150),text('c','C',900,450))});
  await libraryToDesigner(s.id,subject.id);
  const x = () => (getDoc(s.id,doc.id)!.layers[1] as typeof b).x;
  expect(notesOf(s.id,doc.id)).toEqual(['A','B','C']);
  expect(x()).toBeGreaterThan(b.x);
  expect(getDoc(s.id,doc.id)!.width).toBeGreaterThan(doc.width);
  undoDoc(s.id,doc.id);
  expect(notesOf(s.id,doc.id)).toEqual(['A','B']);
  expect(x()).toBe(b.x);
  expect(getDoc(s.id,doc.id)).toMatchObject({width:doc.width,height:doc.height});
});

for (const kind of ['design-system','brand-kit'] as const) it(`preserves separate layers for equal text in ${kind}`, async () => {
  const s = resetStore();
  const {subject} = await createItem({name:'Twins',kind,space:'library',by:'user',graph:graphOf(text('t1','Original',100,100))});
  const doc = await libraryToDesigner(s.id,subject.id);
  const own = addTextLayer(s.id,doc.id,'Same',{x:40,y:60,width:200},{});
  await saveItem({subjectId:subject.id,mode:'overwrite',space:'library',by:'user',graph:graphOf(text('t1','Original',100,100),text('t2','Same',500,500))});
  await libraryToDesigner(s.id,subject.id);
  const live = getDoc(s.id,doc.id)!;
  expect(notesOf(s.id,doc.id)).toEqual(['Original','Same','Same']);
  expect(live.board!.at.t2.layer).not.toBe(own);
});

it('rejects duplicate node IDs before publishing', async () => {
  const s = resetStore();
  const graph = { ...graphOf(text('dup','primero',100,100), text('dup','segundo',500,100),text('to','destino',100,500)), edges:[{id:'e',source:'dup',target:'to',sourceHandle:'out_ref',targetHandle:'sys_ref'}] };
  const res = await run({cmd:'library.item.create',on:{session:s.id},args:{name:'Dup',kind:'moodboard',space:'library',graph}},{caller:'agent'});
  expect(res).toMatchObject({ok:false,error:{message:expect.stringMatching(/duplicate.*dup/i)}});
  expect(useStore.getState().library).toEqual([]);
  expect(hoisted.blobs.size).toBe(0);
});

it.each(['missing','character'])('rejects new kit references to %s', async (id) => {
  const s = resetStore();
  useStore.setState({library:[{id:'character',name:'Character',kind:'character',refAssetIds:[]}]});
  const res = await run({cmd:'library.item.create',on:{session:s.id},args:{name:'A',kind:'brand-kit',space:'library',kits:[id]}},{caller:'agent'});
  expect(res.ok).toBe(false);
  expect(useStore.getState().library.map(x=>x.id)).toEqual(['character']);
  expect(hoisted.blobs.size).toBe(0);
});

it('revalidates a new kit reference at publication', async () => {
  resetStore();
  const {subject:child} = await createItem({name:'Child',kind:'brand-kit',space:'library',by:'user'});
  const {subject:parent} = await createItem({name:'Parent',kind:'brand-kit',space:'library',by:'user'});
  const keys = [...hoisted.blobs.keys()];
  hoisted.setOnSet(() => { useStore.setState({ library: [parent] }); });
  await expect(saveItem({subjectId:parent.id,mode:'overwrite',space:'library',by:'user',kits:[child.id]})).rejects.toThrow(child.id);
  expect(useStore.getState().library).toEqual([parent]);
  expect([...hoisted.blobs.keys()]).toEqual(keys);
});

it('saves and restores a historical reference after the kit is deleted', async () => {
  resetStore();
  const {subject:child} = await createItem({name:'Child',kind:'brand-kit',space:'library',by:'user'});
  const {subject:parent} = await createItem({name:'Parent',kind:'brand-kit',space:'library',by:'user',kits:[child.id]});
  useStore.setState({library:[parent]});
  const saved = await saveItem({subjectId:parent.id,mode:'overwrite',space:'library',by:'user',name:'Renamed'});
  expect(saved.kits).toEqual([child.id]);
  await saveItem({subjectId:parent.id,mode:'overwrite',space:'library',by:'user',kits:[]});
  const restored = await restoreItemVersion({subjectId:parent.id,versionId:parent.versionId!,space:'library',by:'user'});
  expect(restored.kits).toEqual([child.id]);
});

it('does not publish a creation if its session disappears during the write', async () => {
  const s = resetStore();
  hoisted.setOnSet(key => { if(key.startsWith('libver:')) deleteSession(s.id); });
  const res = await run({cmd:'library.item.create',on:{session:s.id},args:{name:'A medias',kind:'moodboard',space:'designer',graph:graphOf(text('x','uno',100,100))}},{caller:'agent'});
  expect(res.ok).toBe(false);
  expect(useStore.getState().library.map(x=>x.name)).toEqual([]);
  expect(hoisted.blobs.size).toBe(0);
});

it.each([true, false])('cleans only the failed creation after publication (draft=%s)', async (draft) => {
  const s = resetStore();
  const { subject: kept } = await createItem({ name: 'Keep', kind: 'moodboard', space: 'library', by: 'user' });
  const before = [...hoisted.blobs.keys()];
  let published = false;
  const stop = useStore.subscribe((state) => {
    if (published || state.library.length !== 2) return;
    published = true;
    deleteSession(s.id);
  });
  try {
    await expect(createItem({
      name: 'Partial', kind: 'moodboard', space: 'designer', by: 'user', sessionId: s.id, draft,
    })).rejects.toThrow(s.id);
    expect(published).toBe(true);
    expect(useStore.getState().library).toEqual([kept]);
    expect([...hoisted.blobs.keys()]).toEqual(before);
  } finally {
    stop();
  }
});

it('reports Library writes without promising document undo', async () => {
  const s = resetStore();
  const created = await tool(s.id,[{cmd:'library.item.create',args:{name:'Board',kind:'moodboard',space:'library'}}]);
  expect(created.done).toBe(true);
  expect(created.text).toContain('Saved in Library');
  expect(created.text).not.toContain('One Ctrl+Z per document undoes it all');
  expect(useStore.getState().sessions[s.id].docs).toHaveLength(0);
});

it.each(['nodes', 'library'])('keeps the existing document after a %s-only step', async (space) => {
  const s = resetStore();
  const { subject } = await createItem({ name: 'Board', kind: 'moodboard', space: 'library', by: 'user', graph: graphOf(text('x','one',100,100)) });
  const doc = await libraryToDesigner(s.id, subject.id);
  const step = space === 'nodes'
    ? { cmd: 'library.item.open', args: { id: subject.id, space } }
    : { cmd: 'library.item.create', args: { name: 'New', kind: 'moodboard', space } };
  const result = await tool(s.id, [step, { cmd: 'designer.doc.read' }]);
  expect(result.done).toBe(true);
  expect(result.text).toContain(doc.id);
  expect(result.text).not.toContain('One Ctrl+Z per document undoes it all');
});

it('routes a subsequent doc command to the document created in Studio', async () => {
  const s = resetStore();
  const result = await tool(s.id, [
    { cmd: 'library.item.create', args: { name: 'New', kind: 'moodboard' } },
    { cmd: 'designer.doc.read' },
  ]);
  expect(result.done).toBe(true);
  expect(result.text).toContain(useStore.getState().sessions[s.id].docs[0].id);
  expect(result.text).toContain('Saved in Library');
  expect(result.text).not.toContain('One Ctrl+Z per document undoes it all');
});

const imageBytes = (id: string) => hoisted.assetBlobs.get(id)?.text();
const paint = (id: string, label: string, width = 800) =>
  saveAssetEdit(id, new Blob([label], { type: 'image/png' }), 'original', { width, height: 600 });
const imageIds = (graph: Graph | undefined) => graph?.nodes.flatMap(n => n.data.kind === 'asset' ? [n.data.assetId] : []);

it('restores the original image once for multiple nodes that share it', async () => {
  const s = resetStore();
  useStore.setState({ assets: { a: mkAsset('a', s.id) } });
  putImageBlob('a');
  const graph = graphOf(asset('a', 100, 100), { ...asset('a', 400, 400), id: 'alias' });
  const { subject } = await createItem({ name: 'Pixels', kind: 'moodboard', space: 'library', by: 'user', graph });
  expect((await readKitVersion(subject.versionId!))?.revs).toBeUndefined();
  expect(await paint('a', 'img:painted', 320)).not.toBeNull();

  const restored = await restoreItemVersion({ subjectId: subject.id, versionId: subject.versionId!, space: 'library', by: 'user' });
  const [copy] = imageIds(restored.graph)!;
  expect(copy).not.toBe('a');
  expect(Object.keys(useStore.getState().assets).sort()).toEqual(['a', copy].sort());
  expect(useStore.getState().assets[copy!]).toMatchObject({ copiedFromAssetId: 'a', name: 'a.png', width: 800, height: 600, mime: 'image/png' });
  const opened = libraryToNodes(s.id, subject.id);
  expect(imageIds({ nodes: opened.added, edges: opened.edges })).toEqual([copy, copy]);
  expect(imageIds((await readKitVersion(restored.versionId!))?.graph)).toEqual([copy, copy]);
  expect(await imageBytes(copy!)).toBe('img:a');
  expect(await imageBytes('a')).toBe('img:painted');
});

it('pins a nonzero revision across asset undo and redo while normal opens use the live image', async () => {
  const s = resetStore();
  useStore.setState({ assets: { a: mkAsset('a', s.id) } });
  putImageBlob('a');
  expect(await paint('a', 'img:first')).not.toBeNull();
  const { subject } = await createItem({ name: 'Pixels', kind: 'moodboard', space: 'library', by: 'user', graph: graphOf(asset('a', 100, 100)) });
  expect(await paint('a', 'img:second')).not.toBeNull();
  const revisions = () => normalizeAssetRevisions(useStore.getState().assets.a);
  const order = revisions().versions.map(r => r.assetId);
  expect(await undoAssetRevision('a')).toBe(true);
  expect(revisions().index).toBe(1);
  expect(await redoAssetRevision('a')).toBe(true);
  expect(revisions().index).toBe(2);
  expect(await undoAssetRevision('a')).toBe(true);
  expect(await undoAssetRevision('a')).toBe(true);
  expect(revisions()).toMatchObject({ index: 0, versions: order.map(assetId => ({ assetId })) });
  const opened = libraryToNodes(s.id, subject.id);
  expect(imageIds({ nodes: opened.added, edges: opened.edges })).toEqual(['a']);
  expect(await imageBytes('a')).toBe('img:a');
  const saved = await saveItem({ subjectId: subject.id, mode: 'overwrite', space: 'library', by: 'user' });
  expect(imageIds(saved.graph)).toEqual(['a']);
  const restored = await restoreItemVersion({ subjectId: subject.id, versionId: subject.versionId!, space: 'library', by: 'user' });
  const [copy] = imageIds(restored.graph)!;
  expect(await imageBytes(copy!)).toBe('img:first');
  expect((await readKitVersion(subject.versionId!))?.revs).toEqual({ a: 1 });
  expect((await readKitVersion(saved.versionId!))?.revs).toBeUndefined();
});

it.each(['missing revision', 'failed version write'])('leaves Library and its blobs intact on %s', async (failure) => {
  const s = resetStore();
  useStore.setState({ assets: { a: mkAsset('a', s.id), b: mkAsset('b', s.id) } });
  putImageBlob('a');
  putImageBlob('b');
  const { subject } = await createItem({ name: 'Pixels', kind: 'moodboard', space: 'library', by: 'user', graph: graphOf(asset('a', 100, 100), asset('b', 400, 400)) });
  expect(await paint('a', 'img:first')).not.toBeNull();
  expect(await paint('b', 'img:other')).not.toBeNull();
  if (failure === 'missing revision') {
    const original = normalizeAssetRevisions(useStore.getState().assets.b).versions[0].assetId;
    hoisted.assetBlobs.delete(original);
  }
  const before = useStore.getState();
  const assets = [...hoisted.assetBlobs.keys()], versions = [...hoisted.blobs.keys()];
  let wroteCopies = false;
  if (failure === 'failed version write') hoisted.setOnSet(() => {
    wroteCopies = hoisted.assetBlobs.size === assets.length + 2;
    throw new Error('Version write failed');
  });
  await expect(restoreItemVersion({ subjectId: subject.id, versionId: subject.versionId!, space: 'library', by: 'user' })).rejects.toThrow(/revision|version write/i);
  if (failure === 'failed version write') expect(wroteCopies).toBe(true);
  expect(useStore.getState().library).toBe(before.library);
  expect(useStore.getState().assets).toBe(before.assets);
  expect([...hoisted.assetBlobs.keys()]).toEqual(assets);
  expect([...hoisted.blobs.keys()]).toEqual(versions);
});

it('aborts a restore if a reused image changes during the version write', async () => {
  const s = resetStore();
  useStore.setState({ assets: { a: mkAsset('a', s.id) } });
  putImageBlob('a');
  expect(await paint('a', 'img:painted')).not.toBeNull();
  const { subject } = await createItem({ name: 'Pixels', kind: 'moodboard', space: 'library', by: 'user', graph: graphOf(asset('a', 100, 100)) });
  const versions = [...hoisted.blobs.keys()], assets = [...hoisted.assetBlobs.keys()];
  hoisted.setOnSet(async () => { expect(await undoAssetRevision('a')).toBe(true); });
  await expect(restoreItemVersion({ subjectId: subject.id, versionId: subject.versionId!, space: 'library', by: 'user' })).rejects.toThrow(/changed while restoring/i);
  expect(useStore.getState().library).toEqual([subject]);
  expect(await imageBytes('a')).toBe('img:a');
  expect([...hoisted.assetBlobs.keys()]).toEqual(assets);
  expect([...hoisted.blobs.keys()]).toEqual(versions);
});
