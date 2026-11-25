import { uid } from '../lib/id';
import { blobDb, deleteAssetBlobs } from '../lib/idb';
import { setDoc, useStore } from '../store/store';
import { copyAssetRevision, normalizeAssetRevisions } from './assetRevisions';
import { addDoc, getDoc, selectDoc } from './design/actions';
import * as D from './design/doc';
import { canRedo, canUndo, dropHistory } from './design/history';
import { flushRaster, rasterBufferIds } from './design/raster';
import { wouldCreateKitCycle } from './libraryGraph';
import { assetRatio, boardNodes, bringGraph, graphFromDoc, loadBoardImages, withoutGone } from './libraryBoard';
import { NODE_WIDTH } from './flow/graph-layout';
import { boardLayout, fromOrigin } from './libraryLayout';
import { copyDocPixels, expectedRasterIds, readKitVersion, remapDoc, rKey, vKey, withCleanup, writeVerified, type KitVersionSnapshot } from './librarySnapshot';
import { validateTokens } from './libraryTokens';
import { isKit, KIT_KINDS, type KitActor, type KitFont, type KitKind, type KitTokens, type KitVersionRef, type LibrarySpace } from './libraryTypes';
import type { Asset, DesignDoc, Graph, Subject } from './types';

export { cleanupKeys, copyDocPixels, expectedRasterIds, readKitVersion, type KitVersionSnapshot } from './librarySnapshot';

/* Immutable versioned snapshots (`libver:<id>`) and pixel-safe open/save/restore/delete for Library items. */
const get = useStore.getState;
const queues = new Map<string, Promise<void>>();
function serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(id) ?? Promise.resolve()).then(fn), tail = next.then(() => undefined, () => undefined);
  queues.set(id, tail);
  void tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
  return next;
}
const docGroupIds = (doc?: DesignDoc) => doc ? (doc.groups ?? []).filter((g) => doc.layers.some((l) => l.groupId === g.id)).map((g) => g.id) : undefined;
const hasGraph = (g?: Graph) => Boolean(g && (g.nodes.length || g.edges.length || g.groups?.length));

function validateContent(kind: KitKind, subjectId: string, opts: { graph?: Graph; kits?: string[]; tokens?: KitTokens; checkAssets: boolean; newKitIds?: readonly string[] }): string[] {
  const spec = KIT_KINDS[kind], checked: string[] = [];
  if (opts.tokens && Object.keys(opts.tokens).length) { if (!spec.tokens) throw new Error(`Kind "${kind}" does not support tokens.`); validateTokens(opts.tokens); }
  if (opts.kits?.length) {
    if (!spec.kits) throw new Error(`Kind "${kind}" cannot contain other kits.`);
    const cycle = wouldCreateKitCycle(get().library, subjectId, opts.kits, opts.newKitIds);
    if (!cycle.ok) throw new Error(cycle.reason);
  }
  if (!opts.graph) return checked;
  const assets = get().assets, nodeIds = new Set<string>();
  for (const { id, data: d } of opts.graph.nodes) {
    if (nodeIds.has(id)) throw new Error(`Duplicate node ID "${id}".`);
    nodeIds.add(id);
    if (d.kind === 'asset') {
      if (!d.assetId?.trim()) throw new Error(`Asset node "${id}" requires assetId.`);
      if (opts.checkAssets) { if (!assets[d.assetId]) throw new Error(`Node "${id}" references missing asset "${d.assetId}".`); checked.push(d.assetId); }
    } else if (d.kind === 'text') {
      if (!d.text.trim()) throw new Error(`Text node "${id}" requires text.`);
    } else if (d.kind === 'part') {
      if (!(spec.parts as readonly string[]).includes(d.partKind)) throw new Error(`Kind "${kind}" does not support part "${d.partKind}".`);
      if (d.partKind === 'color' && !d.color?.trim()) throw new Error(`Color part "${id}" requires color.`);
      if (d.partKind === 'component' && (!d.groupId?.trim() || !d.title.trim())) throw new Error(`Component part "${id}" requires groupId and title.`);
      if (d.partKind === 'style' && ((d.styleType !== 'text' && d.styleType !== 'color') || !d.values || !Object.keys(d.values).length)) throw new Error(`Style part "${id}" requires styleType and values.`);
    } else throw new Error(`Unsupported Library graph node kind "${d.kind}".`);
  }
  for (const e of opts.graph.edges) if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) throw new Error(`Edge "${e.id}" references a missing node.`);
  return checked;
}

const snapshotAssets = (s: Pick<Subject, 'frontalAssetId' | 'refAssetIds' | 'videoAssetId'>, graph?: Graph, doc?: DesignDoc) =>
  [...new Set([s.frontalAssetId, ...s.refAssetIds, s.videoAssetId, ...(graph?.nodes ?? []).map((n) => (n.data.kind === 'asset' ? n.data.assetId ?? undefined : undefined)), ...(doc?.layers ?? []).map((l) => ('sourceAssetId' in l ? l.sourceAssetId : undefined))].filter((x): x is string => Boolean(x)))];
function graphImageRevs(graph: Graph | undefined): Record<string, number> {
  const assets = get().assets;
  return Object.fromEntries((graph?.nodes ?? []).flatMap(({ data }) => {
    const asset = data.kind === 'asset' && data.assetId ? assets[data.assetId] : undefined;
    const index = asset?.kind === 'image' && normalizeAssetRevisions(asset).index;
    return asset && index ? [[asset.id, index]] : [];
  }));
}

const requireItem = (id: string): Subject => { const e = get().library.find((s) => s.id === id); if (!e || !isKit(e)) throw new Error(`No Library item "${id}".`); return e; };
const detachWorkingDoc = (sessionId: string, docId: string) => setDoc(sessionId, docId, (d) => {
  const { library, board: _board, ...rest } = d;
  return { ...rest, ...(library?.view === 'studio' ? { view: 'studio' as const } : {}), name: d.name.endsWith(' (local copy)') ? d.name : `${d.name} (local copy)` };
});
const linkedBlankDoc = (name: string, subjectId: string, versionId: string, docRev?: string, view?: 'studio', w = 1080, h = 1080): DesignDoc =>
  ({ ...D.createDoc(name, w, h, null), library: { subjectId, versionId, ...(docRev ? { docRev } : {}), ...(view ? { view } : {}) } });

function optionalFields(c: { description?: string; graph?: Graph; kits?: string[]; tokens?: KitTokens; docRev?: string; groupIds?: string[] }) {
  const graph = hasGraph(c.graph) ? c.graph : undefined, kits = c.kits?.length ? [...new Set(c.kits)] : undefined, tokens = c.tokens && Object.keys(c.tokens).length ? c.tokens : undefined;
  return { ...(c.description ? { description: c.description } : {}), ...(graph ? { graph } : {}), ...(kits ? { kits } : {}), ...(tokens ? { tokens } : {}), ...(c.docRev ? { docRev: c.docRev } : {}), ...(c.groupIds?.length ? { groupIds: c.groupIds } : {}) };
}

/** Single verified version writer shared by create, save, and restore: writes blob, re-reads live store, cleans up on error. */
async function commitVersion(
  entry: Subject,
  c: { mode: 'append' | 'create'; at: number; by: KitActor; space: LibrarySpace; label?: string; name?: string; description?: string; graph?: Graph; kits?: string[]; tokens?: KitTokens; fonts?: KitFont[]; sections?: string[]; doc?: DesignDoc; docRev?: string; storedRasterIds?: string[]; clearsDraft?: boolean; checkAssetIds?: string[]; newKitIds?: readonly string[]; createSessionId?: string; copyAssets?: Record<string, Asset>; liveRevs?: ReadonlyMap<string, number> },
  written: string[],
): Promise<Subject> {
  const verId = uid('lv'), groupIds = docGroupIds(c.doc), fields = optionalFields({ description: c.description, graph: c.graph, kits: c.kits, tokens: c.tokens, docRev: c.docRev, groupIds });
  const revs = graphImageRevs(fields.graph);
  const snap: KitVersionSnapshot = { id: verId, subjectId: entry.id, at: c.at, by: c.by, space: c.space, ...(c.label ? { label: c.label } : {}), ...(fields.graph ? { graph: fields.graph } : {}), ...(fields.kits ? { kits: fields.kits } : {}), ...(fields.tokens ? { tokens: fields.tokens } : {}), ...(c.doc ? { doc: c.doc, ...(c.docRev ? { docRev: c.docRev } : {}), ...(c.storedRasterIds ? { storedRasterIds: c.storedRasterIds } : {}) } : {}) };
  if (Object.keys(revs).length) snap.revs = revs;
  const kept = get().library.find((x) => x.id === entry.id) ?? entry, fonts = c.fonts ?? kept.fonts, sections = c.sections ?? kept.sections;
  if (entry.kind !== 'moodboard') Object.assign(snap, { fonts: fonts ?? [], sections: sections ?? [] });
  const encoded = new TextEncoder().encode(JSON.stringify(snap));
  await writeVerified(vKey(verId), new Blob([encoded], { type: 'application/json' }), encoded, written);
  const ref: KitVersionRef = { id: verId, at: c.at, by: c.by, space: c.space, ...(c.label ? { label: c.label } : {}), assetIds: snapshotAssets(entry, fields.graph, c.doc), ...(c.docRev ? { docRev: c.docRev } : {}), ...(groupIds?.length ? { groupIds } : {}) };
  let updated: Subject | null = null;
  useStore.setState((st) => {
    if (c.createSessionId && !st.sessions[c.createSessionId]) throw new Error(`No session "${c.createSessionId}".`);
    const missing = c.checkAssetIds?.find((aid) => !st.assets[aid]);
    for (const [id, index] of c.liveRevs ?? []) {
      if (st.assets[id]?.kind !== 'image' || normalizeAssetRevisions(st.assets[id]).index !== index) throw new Error(`Image "${id}" changed while restoring.`);
    }
    if (missing) throw new Error(`Asset "${missing}" was deleted while saving.`);
    if (fields.kits?.length) { const cy = wouldCreateKitCycle(st.library, entry.id, fields.kits, c.newKitIds); if (!cy.ok) throw new Error(cy.reason); }
    if (c.mode === 'create') { updated = { ...entry, ...fields, versionId: verId, versions: [ref] }; return { library: [...st.library, updated] }; }
    const live = st.library.find((x) => x.id === entry.id);
    if (!live || !isKit(live)) return {};
    const { graph: _g, kits: _k, tokens: _t, docRev: _dr, groupIds: _gi, description: _d, ...base } = live;
    updated = { ...base, name: c.name ?? live.name, ...optionalFields({ ...fields, description: c.description !== undefined ? c.description : live.description }), ...(c.fonts ? { fonts: c.fonts } : {}), ...(c.sections ? { sections: c.sections } : {}), draft: c.clearsDraft ? false : live.draft, versionId: verId, versions: [...(live.versions ?? []), ref], origin: live.origin };
    return {
      library: st.library.map((x) => (x.id === entry.id ? updated! : x)),
      ...(c.copyAssets ? { assets: { ...st.assets, ...c.copyAssets } } : {}),
    };
  });
  if (!updated) throw new Error(`Library item "${entry.id}" was deleted while saving.`);
  return updated;
}

export async function createItem(opts: {
  name: string; kind: KitKind; space: LibrarySpace; by: KitActor; sessionId?: string;
  description?: string; from?: string[]; graph?: Graph; kits?: string[]; tokens?: KitTokens; draft?: boolean; open?: boolean;
}): Promise<{ subject: Subject; doc?: DesignDoc }> {
  const name = opts.name.trim();
  if (!name) throw new Error('Item name is required.');
  const graph = opts.graph && fromOrigin(opts.graph), { description, kits, tokens } = opts;
  const id = uid('sub'), session = opts.sessionId ? get().sessions[opts.sessionId] : undefined;
  if (opts.sessionId && !session) throw new Error(`No session "${opts.sessionId}".`);
  const checkAssetIds = validateContent(opts.kind, id, { graph, kits, tokens, checkAssets: true, newKitIds: kits });
  const draft = opts.draft ?? (opts.space === 'studio' && Boolean(session)), at = Date.now();
  const origin = { space: opts.space, by: opts.by, at, ...(session ? { sessionId: session.id, sessionTitle: session.title } : {}), ...(opts.from?.length ? { from: [...opts.from] } : {}) };
  const base: Subject = { id, name, kind: opts.kind, refAssetIds: [], ...optionalFields({ description, graph, kits, tokens }), draft, origin };
  return withCleanup(async (written) => {
    try {
      const subject = draft
        ? (useStore.setState((st) => ({ library: [...st.library, base] })), base)
        : await commitVersion(base, { mode: 'create', at, by: opts.by, space: opts.space, description, graph, kits, tokens, checkAssetIds, newKitIds: kits, createSessionId: session?.id }, written);
      if (opts.open === false || !session || (opts.space !== 'studio' && opts.space !== 'designer')) return { subject };
      let doc: DesignDoc;
      if (hasGraph(graph)) {
        doc = await openInSpace(session.id, id, opts.space);
      } else {
        doc = linkedBlankDoc(name, id, subject.versionId ?? '', subject.docRev, opts.space === 'studio' ? 'studio' : undefined);
        addDoc(session.id, doc);
      }
      if (!getDoc(session.id, doc.id)) throw new Error(`Could not open the new item in session "${session.id}".`);
      return { subject, doc };
    } catch (error) {
      await deleteItem(id);
      throw error;
    }
  });
}

function openInSpace(sessionId: string, subjectId: string, space: 'studio' | 'designer'): Promise<DesignDoc> {
  return serialize(subjectId, async () => {
    const subject = requireItem(subjectId), session = get().sessions[sessionId];
    if (!session) throw new Error(`No session "${sessionId}".`);
    const curVer = subject.versionId ?? '', curDocRev = subject.docRev ?? '', existing = session.docs.find((d) => d.library?.subjectId === subjectId);
    const same = curDocRev ? existing?.library?.docRev === curDocRev : Boolean(existing && !existing.library?.docRev);
    if (existing && same) {
      const promote = space === 'designer' && Boolean(existing.library?.view || existing.view);
      if (promote || existing.name !== subject.name) {
        setDoc(sessionId, existing.id, (d) => {
          const { view: _v, ...rest } = d;
          const lib = d.library && promote ? { subjectId: d.library.subjectId, versionId: d.library.versionId, ...(d.library.docRev ? { docRev: d.library.docRev } : {}) } : d.library;
          return { ...(promote ? rest : d), name: subject.name, library: lib };
        });
      }
      const prepared = await loadBoardImages(existing, subject.graph, subject.kind);
      bringGraph(sessionId, existing.id, subject.graph, subject.kind, prepared);
      setDoc(sessionId, existing.id, (d) => (d.library?.subjectId === subjectId && d.library.versionId !== curVer ? { ...d, library: { ...d.library, versionId: curVer } } : d));
      selectDoc(sessionId, existing.id);
      return getDoc(sessionId, existing.id) ?? existing;
    }
    const snap = curVer ? await readKitVersion(curVer) : null;
    if (curVer && !snap) throw new Error(`Version "${curVer}" blob is missing.`);
    return withCleanup(async (written) => {
      const docRev = snap?.doc ? (snap.docRev ?? subject.docRev) : undefined;
      const link: NonNullable<DesignDoc['library']> = { subjectId, versionId: curVer, ...(docRev ? { docRev } : {}), ...(space === 'studio' ? { view: 'studio' as const } : {}) };
      const px = snap?.doc ? (await copyDocPixels(snap.doc, null, expectedRasterIds(snap), written)).map : null;
      const graph = snap?.graph ?? subject.graph, items = snap?.doc ? [] : boardNodes(graph), only = items.length === 1 ? items[0] : undefined;
      const image = only?.data.kind === 'asset' ? get().assets[only.data.assetId!] : undefined;
      const fit = image && image.width > 0 && image.height > 0 ? Math.min(1, 4096 / Math.max(image.width, image.height)) : 0;
      // One image is the page; several elements share one at their positions.
      const page = fit ? { width: Math.round(image!.width * fit), height: Math.round(image!.height * fit) } : items.length > 1 ? boardLayout(items, assetRatio) : { width: 1080, height: 1080 };
      const k = page.width / NODE_WIDTH, board = !items.length ? undefined : fit ? { k, x: -only!.position.x * k, y: -only!.position.y * k } : boardLayout(items, assetRatio, page);
      const doc = snap?.doc
        ? { ...remapDoc(snap.doc, px!, { newDocId: true, library: link }), name: subject.name }
        : { ...linkedBlankDoc(subject.name, subjectId, curVer, docRev, space === 'studio' ? 'studio' : undefined, page.width, page.height), ...(board ? { board: { k: board.k, x: board.x, y: board.y, at: {} } } : {}) };
      const liveExisting = get().sessions[sessionId]?.docs.find((d) => d.id === existing?.id && d.library?.subjectId === subjectId);
      if (liveExisting) detachWorkingDoc(sessionId, liveExisting.id);
      addDoc(sessionId, doc);
      const prepared = await loadBoardImages(doc, graph, subject.kind);
      // If the user edited during loading, the import needs its own undo step after theirs.
      const editedDuringLoad = canUndo(doc.id) || canRedo(doc.id);
      bringGraph(sessionId, doc.id, graph, subject.kind, prepared);
      if (!editedDuringLoad) dropHistory(doc.id);
      return getDoc(sessionId, doc.id) ?? doc;
    });
  });
}
export const libraryToStudio = (sessionId: string, subjectId: string) => openInSpace(sessionId, subjectId, 'studio');
export const libraryToDesigner = (sessionId: string, subjectId: string) => openInSpace(sessionId, subjectId, 'designer');

/** A free name for a copy: Name_v2, Name_v3… */
function copyName(name: string): string {
  const taken = new Set(get().library.map((s) => s.name)), base = name.replace(/_v\d+$/, '');
  let next = name;
  for (let i = 2; taken.has(next); i++) next = `${base}_v${i}`;
  return next;
}

export function saveItem(opts: {
  subjectId: string; mode: 'overwrite' | 'copy'; space: LibrarySpace; by: KitActor; sessionId?: string; docId?: string;
  label?: string; name?: string; description?: string; graph?: Graph | ((prev?: Graph) => Graph); kits?: string[]; tokens?: KitTokens | ((prev: KitTokens) => KitTokens); fonts?: (prev: KitFont[]) => KitFont[];
}): Promise<Subject> {
  return serialize(opts.subjectId, async () => {
    const cur = requireItem(opts.subjectId), kind = cur.kind as KitKind, targetId = opts.mode === 'copy' ? uid('sub') : cur.id;
    const workDoc = opts.docId && opts.sessionId ? getDoc(opts.sessionId, opts.docId) : undefined, owner = workDoc?.library?.subjectId;
    if (opts.docId && !workDoc) throw new Error(`No document "${opts.docId}".`);
    if (owner && owner !== cur.id && get().library.some((s) => s.id === owner)) throw new Error(`"${workDoc!.name}" belongs to another Library entry.`);
    // A linked design writes back what it changed; a loose one only starts an entry that is still empty.
    const back = workDoc && opts.graph === undefined && (owner === cur.id ? workDoc.board || !hasGraph(cur.graph) : !hasGraph(cur.graph)) ? graphFromDoc(cur.graph, owner === cur.id ? workDoc : { ...workDoc, board: undefined }, kind === 'moodboard') : undefined;
    const graph = typeof opts.graph === 'function' ? opts.graph(cur.graph) : opts.graph !== undefined ? fromOrigin(opts.graph) : back ? back.graph : cur.graph;
    const kits = opts.kits !== undefined ? opts.kits : cur.kits, tokens = typeof opts.tokens === 'function' ? opts.tokens(cur.tokens ?? {}) : opts.tokens !== undefined ? opts.tokens : cur.tokens;
    const newKitIds = kits?.filter((id) => !cur.kits?.includes(id));
    const checkAssetIds = validateContent(kind, targetId, { graph, kits, tokens, checkAssets: opts.graph !== undefined, newKitIds });
    const session = opts.sessionId ? get().sessions[opts.sessionId] : undefined;
    if (workDoc) { const assets = get().assets; for (const l of workDoc.layers) if ('sourceAssetId' in l && l.sourceAssetId && assets[l.sourceAssetId]) checkAssetIds.push(l.sourceAssetId); }
    const prevSnap = cur.versionId ? (workDoc ? await readKitVersion(cur.versionId).catch(() => null) : await readKitVersion(cur.versionId)) : null;
    if (!workDoc && cur.versionId && !prevSnap) throw new Error(`Cannot save "${cur.id}": current version "${cur.versionId}" blob is missing.`);
    return withCleanup(async (written) => {
      let storedDoc: DesignDoc | undefined, storedRasterIds: string[] | undefined, docRev: string | undefined;
      if (workDoc || (prevSnap?.doc && opts.mode === 'copy')) {
        if (workDoc) await flushRaster();
        const src = workDoc ? { ...workDoc, ...(back?.board ? { board: back.board } : {}) } : withoutGone(prevSnap!.doc!, graph);
        const copied = await copyDocPixels(src, workDoc && opts.mode === 'overwrite' ? prevSnap?.doc : null, workDoc ? undefined : expectedRasterIds(prevSnap!), written);
        storedDoc = remapDoc(src, copied.map, { newDocId: false }); storedRasterIds = copied.storedIds; docRev = uid('drev');
      } else if (prevSnap?.doc) {
        storedDoc = withoutGone(prevSnap.doc, graph); const ids = new Set(rasterBufferIds(storedDoc.layers));
        storedRasterIds = (prevSnap.storedRasterIds ?? [...ids]).filter((rid) => ids.has(rid));
        for (const rid of expectedRasterIds({ ...prevSnap, doc: storedDoc, storedRasterIds })) if (!(await blobDb.get(rKey(rid)))) throw new Error(`Missing expected pixel blob "${rKey(rid)}".`);
        docRev = prevSnap.docRev ?? cur.docRev ?? uid('drev');
      }
      const at = Date.now(), targetEntry: Subject = opts.mode === 'copy'
        ? { id: targetId, name: copyName(opts.name?.trim() || cur.name), kind, refAssetIds: [], ...(cur.sections ? { sections: cur.sections } : {}), ...(cur.fonts ? { fonts: cur.fonts } : {}), copiedFrom: cur.id, draft: opts.by === 'user' ? false : Boolean(cur.draft), origin: { space: opts.space, by: opts.by, at, ...(session ? { sessionId: session.id, sessionTitle: session.title } : {}) } }
        : cur;
      const saved = await commitVersion(targetEntry, {
        mode: opts.mode === 'copy' ? 'create' : 'append', at, by: opts.by, space: opts.space, label: opts.label,
        name: opts.mode === 'overwrite' && opts.name?.trim() ? opts.name.trim() : undefined,
        description: opts.description !== undefined ? opts.description : (opts.mode === 'copy' ? cur.description : undefined),
        graph, kits, tokens, fonts: opts.fonts?.(cur.fonts ?? []), doc: storedDoc, docRev, storedRasterIds, clearsDraft: opts.by === 'user', checkAssetIds, newKitIds,
      }, written);
      if (opts.mode === 'overwrite' && workDoc && opts.sessionId) setDoc(opts.sessionId, workDoc.id, (d) => (back?.board ? { ...d, board: { ...back.board, ...(d.board ? { x: d.board.x, y: d.board.y } : {}) } } : d));
      if (opts.mode === 'overwrite' && workDoc && opts.sessionId && workDoc.library?.subjectId === cur.id) {
        setDoc(opts.sessionId, workDoc.id, (d) => d.library?.subjectId === cur.id ? { ...d, library: { ...d.library, versionId: saved.versionId!, ...(docRev ? { docRev } : {}) } } : d);
      }
      return saved;
    });
  });
}

/** A design of its own becomes a new entry and stays linked to it. */
export async function saveAsNew(o: { sessionId: string; docId: string; name: string; kind: KitKind; space: LibrarySpace; by: KitActor; description?: string; label?: string }): Promise<Subject> {
  const { kind, space, by, sessionId, docId, name, description } = o;
  const { subject } = await createItem({ name, kind, space, by, sessionId, description, draft: by === 'user' || space === 'studio', open: false });
  try {
    const saved = await saveItem({ subjectId: subject.id, mode: 'overwrite', space, by, sessionId, docId, name, label: o.label });
    setDoc(sessionId, docId, (d) => ({ ...d, name: saved.name, library: { subjectId: saved.id, versionId: saved.versionId!, ...(saved.docRev ? { docRev: saved.docRev } : {}), ...(space === 'studio' ? { view: 'studio' as const } : {}) } }));
    return saved;
  } catch (err) { await deleteItem(subject.id); throw err; }
}

async function restoreGraphImages(snap: KitVersionSnapshot, written: string[]) {
  const assets = get().assets, copies = new Map<string, Asset>(), liveRevs = new Map<string, number>();
  for (const { data } of snap.graph?.nodes ?? []) {
    if (data.kind !== 'asset' || !data.assetId) continue;
    const id = data.assetId, source = assets[id], saved = Object.hasOwn(snap.revs ?? {}, id) ? snap.revs![id] : 0;
    if (copies.has(id) || liveRevs.has(id)) continue;
    if (source?.kind !== 'image') {
      if (saved) throw new Error(`Missing image "${id}" revision ${saved}.`);
      continue;
    }
    const { versions, index } = normalizeAssetRevisions(source);
    if (index === saved) { liveRevs.set(id, index); continue; }
    const rev = versions[saved];
    if (!rev) throw new Error(`Missing image "${id}" revision ${saved}.`);
    copies.set(id, await copyAssetRevision(source, rev, written));
  }
  const graph = snap.graph && copies.size ? { ...snap.graph, nodes: snap.graph.nodes.map((n) => {
    if (n.data.kind !== 'asset' || !n.data.assetId) return n;
    const copy = copies.get(n.data.assetId);
    return copy ? { ...n, data: { ...n.data, assetId: copy.id } } : n;
  }) } : snap.graph;
  // The layers of the document keep their pixels; they are the same images.
  const doc = snap.doc && copies.size ? { ...snap.doc, layers: snap.doc.layers.map((l) => { const copy = l.type === 'raster' && l.sourceAssetId ? copies.get(l.sourceAssetId) : undefined; return copy ? { ...l, sourceAssetId: copy.id } : l; }) } : snap.doc;
  return { graph, doc, liveRevs, copyAssets: copies.size ? Object.fromEntries([...copies.values()].map(a => [a.id, a])) : undefined };
}

export function restoreItemVersion(opts: { subjectId: string; versionId: string; space: LibrarySpace; by: KitActor; label?: string }): Promise<Subject> {
  return serialize(opts.subjectId, async () => {
    const cur = requireItem(opts.subjectId), snap = await readKitVersion(opts.versionId);
    if (!snap) throw new Error(`Version "${opts.versionId}" blob is missing and cannot be restored.`);
    if (snap.subjectId !== cur.id) throw new Error(`Version "${opts.versionId}" belongs to another Library entry ("${snap.subjectId}").`);
    validateContent(cur.kind as KitKind, cur.id, { graph: snap.graph, kits: snap.kits, tokens: snap.tokens, checkAssets: false });
    if (snap.doc) for (const id of expectedRasterIds(snap)) if (!(await blobDb.get(rKey(id)))) throw new Error(`Cannot restore version "${opts.versionId}": missing pixel blob "${rKey(id)}".`);
    const images: string[] = [];
    try {
      return await withCleanup(async (written) => {
        const restored = await restoreGraphImages(snap, images);
        return commitVersion(cur, {
          mode: 'append', at: Date.now(), by: opts.by, space: opts.space, label: opts.label ?? `Restore ${opts.versionId}`,
          ...restored, kits: snap.kits, tokens: snap.tokens, fonts: snap.fonts, sections: snap.sections,
          docRev: snap.doc ? (snap.docRev ?? uid('drev')) : undefined, storedRasterIds: snap.storedRasterIds, clearsDraft: opts.by === 'user',
        }, written);
      });
    } catch (error) {
      if (images.length) await deleteAssetBlobs(images).catch(() => undefined);
      throw error;
    }
  });
}

export function deleteItem(id: string): Promise<void> {
  return serialize(id, async () => {
    const live = get().library.find((s) => s.id === id);
    if (!live || !isKit(live)) return;
    for (const [sid, s] of Object.entries(get().sessions)) for (const d of [...s.docs]) if (d.library?.subjectId === id) detachWorkingDoc(sid, d.id);
    useStore.setState((st) => ({ library: st.library.filter((x) => x.id !== id) }));
  });
}
