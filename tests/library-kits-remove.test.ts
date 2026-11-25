import { expect, it } from 'vitest';
import { asset, graphOf, hoisted, mkAsset, putImageBlob, resetStore, text } from './library-kits-final-fixtures';
import { deleteLayer, duplicateLayer, flattenLayers, getDoc, mergeDown, patchLayer, placeAsset, rasterizeLayer, redoDoc, undoDoc } from '../src/engine/design/actions';
import { groupLayers, setGroupFlag } from '../src/engine/design/groups';
import { canUndo, dropHistory } from '../src/engine/design/history';
import { saveAssetEdit } from '../src/engine/assetRevisions';
import { deleteNodes } from '../src/engine/flow/actions';
import { libraryToNodes, nodesToLibrary } from '../src/engine/flow/fromLibrary';
import { editCompound, editPresentation } from '../src/engine/nodecore/edit';
import { createItem, libraryToDesigner, libraryToStudio, readKitVersion, restoreItemVersion, saveItem } from '../src/engine/libraryVersions';
import { KIT_KIND_LIST, type KitKind, type KitTokens } from '../src/engine/libraryTypes';
import type { Graph, GraphNode } from '../src/engine/types';
import { createSession, useStore } from '../src/store/store';

const nodeIds = (graph?: Graph) => (graph?.nodes ?? []).map(({ id }) => id);
const entry = (id: string) => useStore.getState().library.find((item) => item.id === id)!;
const assetOf = (node: GraphNode) => node.data.kind === 'asset' && node.data.assetId;

async function fixture(kind: KitKind) {
  const session = resetStore(), sid = session.id;
  useStore.setState({ assets: Object.fromEntries(['a', 'b', 'c', 'missing'].map((id) => [id, mkAsset(id, sid)])) });
  for (const id of ['a', 'b', 'c']) putImageBlob(id);
  const parts: GraphNode[] = kind === 'moodboard' ? [] : [
    { id: 'color', position: { x: 1700, y: 100 }, data: { kind: 'part', partKind: 'color', title: 'Color', color: '#000000' } },
    { id: 'component', position: { x: 2100, y: 100 }, data: { kind: 'part', partKind: 'component', title: 'Component', groupId: 'component-group' } },
    { id: 'style', position: { x: 2500, y: 100 }, data: { kind: 'part', partKind: 'style', title: 'Style', styleType: 'text', values: { fontSize: 24 } } },
  ];
  const kits = kind === 'brand-kit' ? [(await createItem({ name: 'Colors', kind: 'design-system', space: 'library', by: 'user' })).subject.id] : undefined;
  const tokens: KitTokens | undefined = kind === 'moodboard' ? undefined : { spacing: { type: 'dimension', value: 8 } };
  const graph = graphOf(asset('a', 100, 100), asset('b', 500, 100), text('note', 'Note', 900, 100), asset('missing', 1300, 100), ...parts);
  const edge = { id: 'ref', source: 'na', target: 'nb', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref' as const };
  graph.edges = [edge];
  graph.groups = [{ id: 'group', title: 'Elements', nodeIds: nodeIds(graph) }];
  const { subject } = await createItem({ name: 'Board', kind, graph, kits, tokens, space: 'library', by: 'user' });
  const id = subject.id;
  const doc = await libraryToDesigner(sid, id);
  const current = () => getDoc(sid, doc.id)!;
  const layer = (node: string) => current().board!.at[node].layer;
  const save = (mode: 'copy' | 'overwrite' = 'overwrite') => saveItem({ subjectId: id, sessionId: sid, docId: doc.id, mode, space: 'designer', by: 'user' });
  return { sid, subject, id, doc, current, layer, save, graph, parts, kits, tokens, edge };
}

it.each(KIT_KIND_LIST)('%s deletes only known elements and restores them through Undo and Versions', async (kind) => {
  const { sid, doc, current, id, layer, save, parts, tokens, kits, edge } = await fixture(kind);
  const a = layer('na');
  expect(current().board?.at.nmissing).toBeUndefined();

  deleteLayer(sid, doc.id, a);
  undoDoc(sid, doc.id);
  const prior = await save();
  expect(prior.graph?.edges).toEqual([edge]);
  const pixelKeys = [...hoisted.blobs.keys()].filter((key) => key.startsWith('raster:'));

  deleteLayer(sid, doc.id, a);
  const copy = await save('copy');
  expect(nodeIds(copy.graph)).not.toContain('na');
  expect(nodeIds(entry(id).graph)).toContain('na');
  expect(copy.versions).toHaveLength(1);
  const saved = await save();
  const remaining = ['nb', 'note', 'nmissing', ...parts.map(({ id }) => id)];
  expect(nodeIds(saved.graph)).toEqual(remaining);
  expect(saved.graph?.edges).toEqual([]);
  expect(saved.graph?.groups?.[0].nodeIds).toEqual(remaining);
  expect(saved.graph?.nodes.filter((n) => n.data.kind === 'part')).toEqual(parts);
  expect(saved.tokens).toEqual(tokens);
  expect(saved.kits).toEqual(kits);
  expect([...hoisted.blobs.keys()]).toEqual(expect.arrayContaining(pixelKeys));
  expect(hoisted.assetBlobs.has('a')).toBe(true);
  expect(useStore.getState().assets.a).toBeDefined();

  undoDoc(sid, doc.id);
  const returned = await save();
  const came = returned.graph!.nodes.filter((node) => assetOf(node) === 'a');
  expect(came.map((node) => node.position)).toEqual(kind === 'moodboard' ? [{ x: 100, y: 100 }] : []);
  expect(current().layers.map((l) => l.id)).toContain(a);

  const restored = await restoreItemVersion({ subjectId: id, versionId: prior.versionId!, space: 'library', by: 'user' });
  expect(restored.graph).toEqual(prior.graph);
  const historicalDoc = (await readKitVersion(restored.versionId!))!.doc!;
  expect(historicalDoc.layers.some((l) => l.id === historicalDoc.board?.at.na.layer)).toBe(true);

  const reloaded = createSession('Reloaded');
  useStore.setState({ sessions: { [reloaded.id]: reloaded }, activeSessionId: reloaded.id, library: JSON.parse(JSON.stringify(useStore.getState().library)) });
  const opened = await libraryToStudio(reloaded.id, copy.id);
  expect(opened.layers.some((l) => l.type === 'raster' && l.sourceAssetId === 'a')).toBe(false);
  expect(libraryToNodes(reloaded.id, id).added.map(assetOf)).toContain('a');
});

it.each(KIT_KIND_LIST)('%s reconciles a Nodes deletion and move in one Designer or Studio undo', async (kind) => {
  const { sid, id, doc, layer, current, save } = await fixture(kind);
  await save();
  dropHistory(doc.id);
  const a = layer('na'), b = layer('nb'), before = current().layers.find((l) => l.id === b)!;
  const { added, groupId } = libraryToNodes(sid, id);
  const aNode = added.find((n) => assetOf(n) === 'a')!, bNode = added.find((n) => assetOf(n) === 'b')!;
  expect(deleteNodes(sid, [aNode.id])).toBeNull();
  const moved = { x: bNode.position.x + 180, y: bNode.position.y + 120 };
  editPresentation(sid, (g) => ({ ...g, nodes: g.nodes.map((n) => n.id === bNode.id ? { ...n, position: moved } : n) }));
  const saved = await nodesToLibrary({ subjectId: id, sessionId: sid, groupId: groupId!, mode: 'overwrite' });
  expect(nodeIds(saved.graph)).not.toContain('na');

  const open = kind === 'moodboard' ? libraryToDesigner : libraryToStudio;
  const opened = await open(sid, id);
  expect(opened.id).toBe(doc.id);
  expect(opened.layers.map(({ id }) => id)).not.toContain(a);
  expect(opened.board?.at.na).toBeUndefined();
  expect(opened.layers.find((l) => l.id === b)).not.toEqual(before);
  undoDoc(sid, doc.id);
  expect(current().layers).toContainEqual(before);
  expect(current().layers.map(({ id }) => id)).toContain(a);
  expect(canUndo(doc.id)).toBe(false);
  redoDoc(sid, doc.id);
  expect(current().layers.map(({ id }) => id)).not.toContain(a);

  const cleanSession = createSession('New working document');
  useStore.setState((st) => ({ sessions: { ...st.sessions, [cleanSession.id]: cleanSession } }));
  const fresh = await open(cleanSession.id, id);
  expect(fresh.layers.some((l) => l.type === 'raster' && l.sourceAssetId === 'a')).toBe(false);
  expect(libraryToNodes(cleanSession.id, id).added.map(assetOf)).not.toContain('a');
});

it.each(KIT_KIND_LIST)('%s brings an edited layer back with one Undo when Nodes removed its element', async (kind) => {
  const { sid, id, doc, current, layer, save } = await fixture(kind);
  const a = layer('na'), note = layer('note');
  await save();
  patchLayer(sid, doc.id, a, { rev: 1, paintFlattened: true });
  patchLayer(sid, doc.id, note, { opacity: 0.4 });
  dropHistory(doc.id);
  const { added, groupId } = libraryToNodes(sid, id);
  expect(deleteNodes(sid, added.filter((n) => assetOf(n) === 'a' || n.data.kind === 'text').map((n) => n.id))).toBeNull();
  await nodesToLibrary({ subjectId: id, sessionId: sid, groupId: groupId!, mode: 'overwrite' });
  await libraryToDesigner(sid, id);
  expect(current().layers.map((l) => l.id)).not.toContain(a);
  expect(current().layers.map((l) => l.id)).not.toContain(note);
  undoDoc(sid, doc.id);
  expect(canUndo(doc.id)).toBe(false);
  expect(current().layers).toEqual(expect.arrayContaining([expect.objectContaining({ id: a, paintFlattened: true }), expect.objectContaining({ id: note, opacity: 0.4 })]));
  const saved = await save();
  // On a moodboard what came back is an element again; elsewhere it stays in the document.
  expect(saved.graph?.nodes.filter((n) => assetOf(n) === 'a')).toHaveLength(kind === 'moodboard' ? 1 : 0);
  expect((await readKitVersion(saved.versionId!))!.doc!.layers.some((l) => l.type === 'raster' && l.sourceAssetId === 'a')).toBe(true);
});

it.each(KIT_KIND_LIST)('%s saves from an open document what it shows, also after Nodes removed it', async (kind) => {
  const { sid, id, current, layer, save } = await fixture(kind), a = layer('na'), note = layer('note');
  await save();
  const raster = (await rasterizeLayer(sid, current().id, note))!, shown = current().layers.map((l) => l.id);
  const { added, groupId } = libraryToNodes(sid, id);
  expect(deleteNodes(sid, added.filter((n) => assetOf(n) === 'a' || n.data.kind === 'text').map((n) => n.id))).toBeNull();
  const without = await nodesToLibrary({ subjectId: id, sessionId: sid, groupId: groupId!, mode: 'overwrite' });
  expect(nodeIds(without.graph)).not.toContain('na');
  const copy = await save('copy'), saved = await save();
  for (const item of [copy, saved]) {
    const snap = (await readKitVersion(item.versionId!))!;
    expect(item.graph!.nodes.filter((n) => assetOf(n) === 'a').map((n) => n.position)).toEqual([{ x: 100, y: 100 }]);
    expect(snap.doc!.layers).toHaveLength(shown.length);
    expect(new Set(snap.storedRasterIds)).toEqual(new Set(snap.doc!.layers.filter((l) => l.type === 'raster').map((l) => l.id)));
  }
  await libraryToDesigner(sid, id);
  expect(current().layers.map((l) => l.id)).toEqual(shown);
  expect(shown).toEqual(expect.arrayContaining([a, raster]));
});

it('what only an earlier version of the document shows does not stop a save from Nodes', async () => {
  const { sid, id, layer, save } = await fixture('moodboard');
  const saved = await save(), snap = (await readKitVersion(saved.versionId!))!, a = layer('na');
  hoisted.blobs.delete(`raster:${(snap.doc!.board!.at.na ?? { layer: a }).layer}`);
  const { added, groupId } = libraryToNodes(sid, id);
  expect(deleteNodes(sid, [added.find((n) => assetOf(n) === 'a')!.id])).toBeNull();
  const next = await nodesToLibrary({ subjectId: id, sessionId: sid, groupId: groupId!, mode: 'overwrite' });
  expect(nodeIds(next.graph)).not.toContain('na');
});

it('an image changed in Nodes shows in a document opened anew, and an open document does not change it back', async () => {
  const { sid, id, save } = await fixture('moodboard');
  await save();
  const { added, groupId } = libraryToNodes(sid, id), n = added.find((x) => assetOf(x) === 'a')!;
  expect(editCompound(sid, 'set-asset', (g) => ({ ...g, nodes: g.nodes.map((x) => (x.id === n.id ? { ...x, data: { ...x.data, assetId: 'c' } as GraphNode['data'] } : x)) }))).toBeNull();
  await nodesToLibrary({ subjectId: id, sessionId: sid, groupId: groupId!, mode: 'overwrite' });
  const other = createSession('Other');
  useStore.setState((st) => ({ sessions: { ...st.sessions, [other.id]: other } }));
  const opened = await libraryToDesigner(other.id, id), l = opened.layers.find((x) => x.id === opened.board!.at.na.layer);
  expect(l?.type === 'raster' && l.sourceAssetId).toBe('c');
  expect(canUndo(opened.id)).toBe(false);
  expect((await save()).graph?.nodes.find((x) => x.id === 'na')?.data).toMatchObject({ assetId: 'c' });
});

it.each(KIT_KIND_LIST)('%s keeps positions through group, merge, flatten and rasterize', async (kind) => {
  const { sid, id, doc, layer, current, save, graph } = await fixture(kind);
  const a = layer('na'), b = layer('nb'), note = layer('note');
  const group = groupLayers(sid, doc.id, [a, b, note])!;
  setGroupFlag(sid, doc.id, group, 'visible', false);
  setGroupFlag(sid, doc.id, group, 'locked', true);
  expect((await save()).graph).toEqual(graph);
  setGroupFlag(sid, doc.id, group, 'locked', false);
  setGroupFlag(sid, doc.id, group, 'visible', true);

  const merged = (await mergeDown(sid, doc.id, b))!;
  const raster = (await rasterizeLayer(sid, doc.id, note))!;
  const flattened = await flattenLayers(sid, doc.id, [merged, raster]);
  expect(current().layers.map(({ id }) => id)).toEqual([flattened]);
  expect((await save()).graph).toEqual(graph);
  undoDoc(sid, doc.id);
  expect(current().layers.map(({ id }) => id)).toEqual([merged, raster]);
  redoDoc(sid, doc.id);
  expect((await save()).graph).toEqual(graph);

  const session = createSession('Copied snapshot');
  useStore.setState((st) => ({ sessions: { ...st.sessions, [session.id]: session } }));
  const reopened = await libraryToDesigner(session.id, id);
  expect(reopened.layers).toHaveLength(1);
  deleteLayer(session.id, reopened.id, reopened.layers[0].id);
  const saved = await saveItem({ subjectId: id, sessionId: session.id, docId: reopened.id, mode: 'overwrite', space: 'designer', by: 'user' });
  expect(nodeIds(saved.graph)).toEqual(nodeIds(graph).filter((n) => !['na', 'nb', 'note'].includes(n)));
  undoDoc(session.id, reopened.id);
  expect(getDoc(session.id, reopened.id)!.layers).toHaveLength(1);
});

it.each(KIT_KIND_LIST)('%s keeps a later Nodes move and addition when an older Designer removes an element', async (kind) => {
  const { sid, id, doc, layer, save } = await fixture(kind);
  const { added, groupId } = libraryToNodes(sid, id);
  const b = added.find((n) => assetOf(n) === 'b')!;
  deleteLayer(sid, doc.id, layer('na'));
  const extra = asset('c', b.position.x, b.position.y + 400);
  expect(editCompound(sid, 'add-node', (g) => ({
    ...g,
    nodes: [...g.nodes.map((n) => n.id === b.id ? { ...n, position: { x: n.position.x + 200, y: n.position.y + 60 } } : n), extra],
    groups: g.groups?.map((g) => g.id === groupId ? { ...g, nodeIds: [...g.nodeIds, extra.id] } : g),
  }))).toBeNull();
  const moved = await nodesToLibrary({ subjectId: id, sessionId: sid, groupId: groupId!, mode: 'overwrite' });
  expect(nodeIds(moved.graph)).toContain(extra.id);
  const saved = await save();
  expect(nodeIds(saved.graph)).toEqual(nodeIds(moved.graph).filter((n) => n !== 'na'));
  expect(saved.graph?.nodes.find((n) => n.id === 'nb')?.position).toEqual(moved.graph?.nodes.find((n) => n.id === 'nb')?.position);
  const roundTrip = libraryToNodes(sid, id);
  expect(roundTrip.added.map(assetOf)).toEqual(expect.arrayContaining(['b', 'c', 'missing']));
  expect(roundTrip.added.map(assetOf)).not.toContain('a');
});

it('a pasted layer with a new ID replaces the cut element, while duplicating keeps the original', async () => {
  const { sid, doc, layer, save } = await fixture('moodboard');
  deleteLayer(sid, doc.id, layer('na'));
  const pasted = (await placeAsset(sid, doc.id, 'a', 'new'))!;
  const saved = await save();
  const images = saved.graph?.nodes.filter((n) => assetOf(n) === 'a') ?? [];
  expect(images).toHaveLength(1);
  expect(images[0].id).not.toBe('na');
  duplicateLayer(sid, doc.id, pasted);
  const duplicated = await save();
  expect(duplicated.graph?.nodes.filter((n) => assetOf(n) === 'a')).toHaveLength(2);
  expect(nodeIds(duplicated.graph)).toContain(images[0].id);
});

it('removing the last element leaves an empty graph and no stale Nodes fallback', async () => {
  const session = resetStore();
  const single = text('one', 'One', 100, 100);
  const graph = { ...graphOf(single), groups: [{ id: 'single', title: 'Single', nodeIds: [single.id] }] };
  const { subject } = await createItem({ name: 'One', kind: 'moodboard', graph, space: 'library', by: 'user' });
  const doc = await libraryToDesigner(session.id, subject.id);
  deleteLayer(session.id, doc.id, doc.layers[0].id);
  const saved = await saveItem({ subjectId: subject.id, sessionId: session.id, docId: doc.id, mode: 'overwrite', space: 'designer', by: 'user' });
  expect(saved.graph?.nodes).toEqual([]);
  expect(libraryToNodes(session.id, subject.id).added).toEqual([]);
});

it('a restored image is the same one in the document and in the graph', async () => {
  const { id, save } = await fixture('moodboard'), first = await save();
  expect(await saveAssetEdit('a', new Blob(['img:painted'], { type: 'image/png' }), 'original')).toBeTruthy();
  const restored = await restoreItemVersion({ subjectId: id, versionId: first.versionId!, space: 'library', by: 'user' });
  const copy = assetOf(restored.graph!.nodes.find((n) => n.id === 'na')!), snap = (await readKitVersion(restored.versionId!))!.doc!;
  expect(copy).not.toBe('a');
  expect(snap.layers.find((l) => l.id === snap.board!.at.na.layer)).toMatchObject({ sourceAssetId: copy });
});
