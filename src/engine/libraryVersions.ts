import { uid } from '../lib/id';
import { blobDb } from '../lib/idb';
import { setDoc, toast, useStore } from '../store/store';
import { addDoc, addTextLayer, getDoc, placeAsset, selectDoc } from './design/actions';
import * as D from './design/doc';
import { flushRaster, isUnreadable, rasterBufferIds } from './design/raster';
import { wouldCreateKitCycle } from './libraryGraph';
import { validateTokens } from './libraryTokens';
import { isKit, KIT_KINDS, type KitActor, type KitKind, type KitTokens, type KitVersionRef, type LibrarySpace } from './libraryTypes';
import type { DesignDoc, Graph, Layer, Subject } from './types';

/* Immutable versioned snapshots (`libver:<id>`) and pixel-safe open/save/restore/delete for Library items. */
export interface KitVersionSnapshot {
  id: string; subjectId: string; at: number; by: KitActor; space: LibrarySpace;
  label?: string; graph?: Graph; kits?: string[]; tokens?: KitTokens; doc?: DesignDoc;
  docRev?: string; storedRasterIds?: string[];
}
const get = useStore.getState, rKey = (id: string) => `raster:${id}`, vKey = (id: string) => `libver:${id}`;
const queues = new Map<string, Promise<void>>();
export const cleanupKeys = (keys: readonly string[]) => (keys.length ? blobDb.delMany([...new Set(keys)]).catch(() => undefined) : Promise.resolve());
async function withCleanup<T>(fn: (written: string[]) => Promise<T>): Promise<T> {
  const written: string[] = [];
  try { return await fn(written); } catch (err) { await cleanupKeys(written); throw err; }
}
function serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(id) ?? Promise.resolve()).then(fn), tail = next.then(() => undefined, () => undefined);
  queues.set(id, tail);
  void tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
  return next;
}
export async function waitKitQueue(id: string): Promise<void> { await queues.get(id); }
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);

async function writeVerified(key: string, blob: Blob, expected: Uint8Array, written: string[]): Promise<void> {
  if (await blobDb.get(key)) throw new Error(`Refusing to overwrite existing blob "${key}".`);
  written.push(key);
  await blobDb.set(key, blob);
  const check = await blobDb.get(key);
  if (!check || !sameBytes(expected, new Uint8Array(await check.arrayBuffer()))) throw new Error(`Could not verify saved blob "${key}" (writer lock missing or storage error).`);
}
export async function readKitVersion(versionId: string): Promise<KitVersionSnapshot | null> {
  const blob = await blobDb.get(vKey(versionId));
  if (!blob) return null;
  try { return JSON.parse(await blob.text()) as KitVersionSnapshot; } catch { throw new Error(`Version "${versionId}" blob is unreadable.`); }
}

const paintBaseIdsOf = (layers: readonly Layer[]) => new Set(layers.flatMap((l) => (l.type === 'raster' && l.paintBaseId ? [l.paintBaseId] : l.type === 'vector' && l.pixelMask?.paintBaseId ? [l.pixelMask.paintBaseId] : [])));
const rasterRevMap = (layers: readonly Layer[]) => new Map(layers.flatMap((l): Array<[string, number]> => (l.type === 'raster' ? [[l.id, l.rev]] : l.type === 'vector' && l.pixelMask ? [[l.pixelMask.id, l.pixelMask.rev]] : [])));
const docGroupIds = (doc?: DesignDoc) => doc ? (doc.groups ?? []).filter((g) => doc.layers.some((l) => l.groupId === g.id)).map((g) => g.id) : undefined;
const hasGraph = (g?: Graph) => Boolean(g && (g.nodes.length || g.edges.length || g.groups?.length));

export const expectedRasterIds = (snap: KitVersionSnapshot): Set<string> =>
  !snap.doc ? new Set() : snap.storedRasterIds !== undefined ? new Set([...snap.storedRasterIds, ...paintBaseIdsOf(snap.doc.layers)]) : new Set(rasterBufferIds(snap.doc.layers));

function remapDoc(doc: DesignDoc, map: ReadonlyMap<string, string>, opts: { newDocId: boolean; library?: DesignDoc['library'] }): DesignDoc {
  const { library: _drop, view: _view, ...rest } = structuredClone(doc), remap = (id: string) => map.get(id) ?? id;
  const layers: Layer[] = rest.layers.map((l) =>
    l.type === 'raster' ? { ...l, id: remap(l.id), ...(l.paintBaseId ? { paintBaseId: remap(l.paintBaseId) } : {}) }
      : l.type === 'vector' && l.pixelMask ? { ...l, pixelMask: { ...l.pixelMask, id: remap(l.pixelMask.id), ...(l.pixelMask.paintBaseId ? { paintBaseId: remap(l.pixelMask.paintBaseId) } : {}) } }
        : l,
  );
  const groups = rest.groups?.map((g) => ({ ...g, ...(g.keptHidden ? { keptHidden: g.keptHidden.map(remap) } : {}), ...(g.keptLocked ? { keptLocked: g.keptLocked.map(remap) } : {}) }));
  return { ...rest, ...(groups ? { groups } : {}), id: opts.newDocId ? uid('doc') : rest.id, layers, activeLayerId: rest.activeLayerId ? remap(rest.activeLayerId) : null, ...(opts.library ? { library: opts.library } : {}) };
}

export async function copyDocPixels(doc: DesignDoc, reuseFrom: DesignDoc | null | undefined, expectedIds: ReadonlySet<string> | undefined, written: string[]): Promise<{ map: Map<string, string>; storedIds: string[] }> {
  const ids = rasterBufferIds(doc.layers), baseIds = paintBaseIdsOf(doc.layers), revMap = rasterRevMap(doc.layers);
  for (const id of ids) if (isUnreadable(id)) throw new Error(`Cannot save: layer pixels "${id}" are unreadable.`);
  const prevEntries: Array<[string, Uint8Array]> = [];
  if (reuseFrom) for (const pid of rasterBufferIds(reuseFrom.layers)) { const b = await blobDb.get(rKey(pid)); if (b) prevEntries.push([pid, new Uint8Array(await b.arrayBuffer())]); }
  const usedPrev = new Set<string>(), map = new Map<string, string>(), storedIds: string[] = [];
  for (const id of ids) {
    const src = await blobDb.get(rKey(id));
    if (!src) {
      if (baseIds.has(id) || (expectedIds ? expectedIds.has(id) : (revMap.get(id) ?? 0) > 0)) throw new Error(`Missing expected pixel blob "${rKey(id)}".`);
      map.set(id, uid('lyr')); continue;
    }
    const bytes = new Uint8Array(await src.arrayBuffer()), match = prevEntries.find(([pid, pb]) => !usedPrev.has(pid) && sameBytes(bytes, pb));
    if (match) { usedPrev.add(match[0]); map.set(id, match[0]); storedIds.push(match[0]); }
    else { const nextId = uid('lyr'); await writeVerified(rKey(nextId), new Blob([bytes], { type: src.type || 'image/png' }), bytes, written); map.set(id, nextId); storedIds.push(nextId); }
  }
  return { map, storedIds };
}

function validateContent(kind: KitKind, subjectId: string, opts: { graph?: Graph; kits?: string[]; tokens?: KitTokens; checkAssets: boolean }): string[] {
  const spec = KIT_KINDS[kind], checked: string[] = [];
  if (opts.tokens && Object.keys(opts.tokens).length) { if (!spec.tokens) throw new Error(`Kind "${kind}" does not support tokens.`); validateTokens(opts.tokens); }
  if (opts.kits?.length) {
    if (!spec.kits) throw new Error(`Kind "${kind}" cannot contain other kits.`);
    const cycle = wouldCreateKitCycle(get().library, subjectId, opts.kits);
    if (!cycle.ok) throw new Error(cycle.reason);
  }
  if (!opts.graph) return checked;
  const assets = get().assets, nodeIds = new Set(opts.graph.nodes.map((n) => n.id));
  for (const { id, data: d } of opts.graph.nodes) {
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
const requireItem = (id: string): Subject => { const e = get().library.find((s) => s.id === id); if (!e || !isKit(e)) throw new Error(`No Library item "${id}".`); return e; };
const detachWorkingDoc = (sessionId: string, docId: string) => setDoc(sessionId, docId, (d) => {
  const { library, ...rest } = d;
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
  c: { mode: 'append' | 'create'; at: number; by: KitActor; space: LibrarySpace; label?: string; name?: string; description?: string; graph?: Graph; kits?: string[]; tokens?: KitTokens; doc?: DesignDoc; docRev?: string; storedRasterIds?: string[]; clearsDraft?: boolean; checkAssetIds?: string[] },
  written: string[],
): Promise<Subject> {
  const verId = uid('lv'), groupIds = docGroupIds(c.doc), fields = optionalFields({ description: c.description, graph: c.graph, kits: c.kits, tokens: c.tokens, docRev: c.docRev, groupIds });
  const snap: KitVersionSnapshot = { id: verId, subjectId: entry.id, at: c.at, by: c.by, space: c.space, ...(c.label ? { label: c.label } : {}), ...(fields.graph ? { graph: fields.graph } : {}), ...(fields.kits ? { kits: fields.kits } : {}), ...(fields.tokens ? { tokens: fields.tokens } : {}), ...(c.doc ? { doc: c.doc, ...(c.docRev ? { docRev: c.docRev } : {}), ...(c.storedRasterIds ? { storedRasterIds: c.storedRasterIds } : {}) } : {}) };
  const encoded = new TextEncoder().encode(JSON.stringify(snap));
  await writeVerified(vKey(verId), new Blob([encoded], { type: 'application/json' }), encoded, written);
  const ref: KitVersionRef = { id: verId, at: c.at, by: c.by, space: c.space, ...(c.label ? { label: c.label } : {}), assetIds: snapshotAssets(entry, fields.graph, c.doc), ...(c.docRev ? { docRev: c.docRev } : {}), ...(groupIds?.length ? { groupIds } : {}) };
  let updated: Subject | null = null;
  useStore.setState((st) => {
    const missing = c.checkAssetIds?.find((aid) => !st.assets[aid]);
    if (missing) throw new Error(`Asset "${missing}" was deleted while saving.`);
    if (fields.kits?.length) { const cy = wouldCreateKitCycle(st.library, entry.id, fields.kits); if (!cy.ok) throw new Error(cy.reason); }
    if (c.mode === 'create') { updated = { ...entry, ...fields, versionId: verId, versions: [ref] }; return { library: [...st.library, updated] }; }
    const live = st.library.find((x) => x.id === entry.id);
    if (!live || !isKit(live)) return {};
    const { graph: _g, kits: _k, tokens: _t, docRev: _dr, groupIds: _gi, description: _d, ...base } = live;
    updated = { ...base, name: c.name ?? live.name, ...optionalFields({ ...fields, description: c.description !== undefined ? c.description : live.description }), draft: c.clearsDraft ? false : live.draft, versionId: verId, versions: [...(live.versions ?? []), ref], origin: live.origin };
    return { library: st.library.map((x) => (x.id === entry.id ? updated! : x)) };
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
  const id = uid('sub'), session = opts.sessionId ? get().sessions[opts.sessionId] : undefined;
  if (opts.sessionId && !session) throw new Error(`No session "${opts.sessionId}".`);
  const checkAssetIds = validateContent(opts.kind, id, { graph: opts.graph, kits: opts.kits, tokens: opts.tokens, checkAssets: true });
  const draft = opts.draft ?? (opts.space === 'studio' && Boolean(session)), at = Date.now();
  const origin = { space: opts.space, by: opts.by, at, ...(session ? { sessionId: session.id, sessionTitle: session.title } : {}), ...(opts.from?.length ? { from: [...opts.from] } : {}) };
  const base: Subject = { id, name, kind: opts.kind, refAssetIds: [], ...optionalFields(opts), draft, origin };
  const subject = draft
    ? (useStore.setState((st) => ({ library: [...st.library, base] })), base)
    : await withCleanup((w) => commitVersion(base, { mode: 'create', at, by: opts.by, space: opts.space, description: opts.description, graph: opts.graph, kits: opts.kits, tokens: opts.tokens, checkAssetIds }, w));
  if (opts.open !== false && session && (opts.space === 'studio' || opts.space === 'designer')) {
    if (hasGraph(opts.graph)) return { subject, doc: await openInSpace(session.id, id, opts.space) };
    const doc = linkedBlankDoc(name, id, subject.versionId ?? '', subject.docRev, opts.space === 'studio' ? 'studio' : undefined);
    addDoc(session.id, doc);
    return { subject, doc };
  }
  return { subject };
}

export function renameItem(id: string, patch: { name?: string; description?: string; by?: KitActor }): Subject {
  let result: Subject | null = null;
  useStore.setState((st) => {
    const cur = st.library.find((x) => x.id === id);
    if (!cur || !isKit(cur)) return {};
    const name = patch.name !== undefined ? patch.name.trim() : cur.name;
    if (!name) throw new Error('Item name cannot be empty.');
    result = { ...cur, name, ...(patch.description !== undefined ? { description: patch.description } : {}), draft: patch.name !== undefined && (patch.by ?? 'user') === 'user' ? false : cur.draft, origin: cur.origin };
    return { library: st.library.map((x) => (x.id === id ? result! : x)) };
  });
  if (!result) throw new Error(`No Library item "${id}".`);
  return result;
}

async function placeKitImage(sessionId: string, docId: string, assetId: string, title?: string): Promise<boolean> {
  const label = title?.trim() || get().assets[assetId]?.name || assetId;
  try { if (await placeAsset(sessionId, docId, assetId, 'new', title || undefined)) return true; } catch {}
  toast(`Could not load image "${label}".`, 'error');
  return false;
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
      if (!curDocRev && (existing.library?.versionId ?? '') !== curVer) {
        const prevVer = existing.library?.versionId ?? '';
        const prevSnap = prevVer ? await readKitVersion(prevVer).catch(() => null) : null;
        if (prevVer && !prevSnap) {
          toast(`Could not read previous version "${prevVer}" to sync new images.`, 'error');
        } else {
          const prevIds = new Set((prevSnap?.graph?.nodes ?? []).flatMap((n) => (n.data.kind === 'asset' && n.data.assetId ? [n.data.assetId] : [])));
          const seen = new Set(existing.layers.map((l) => ('sourceAssetId' in l ? l.sourceAssetId : undefined)));
          for (const n of subject.graph?.nodes ?? []) {
            if (n.data.kind !== 'asset' || !n.data.assetId || prevIds.has(n.data.assetId) || seen.has(n.data.assetId) || get().assets[n.data.assetId]?.kind !== 'image') continue;
            if (await placeKitImage(sessionId, existing.id, n.data.assetId, n.data.title)) seen.add(n.data.assetId);
          }
          setDoc(sessionId, existing.id, (d) => (d.library?.subjectId === subjectId ? { ...d, library: { ...d.library, versionId: curVer } } : d));
        }
      }
      selectDoc(sessionId, existing.id);
      return getDoc(sessionId, existing.id) ?? existing;
    }
    const snap = curVer ? await readKitVersion(curVer) : null;
    if (curVer && !snap) throw new Error(`Version "${curVer}" blob is missing.`);
    return withCleanup(async (written) => {
      const docRev = snap?.doc ? (snap.docRev ?? subject.docRev) : undefined;
      const link: NonNullable<DesignDoc['library']> = { subjectId, versionId: curVer, ...(docRev ? { docRev } : {}), ...(space === 'studio' ? { view: 'studio' as const } : {}) };
      const px = snap?.doc ? (await copyDocPixels(snap.doc, null, expectedRasterIds(snap), written)).map : null;
      const gNodes = snap?.doc ? [] : ((snap?.graph ?? subject.graph)?.nodes ?? []), assets = get().assets;
      const imgs = gNodes.filter((n) => n.data.kind === 'asset' && n.data.assetId && assets[n.data.assetId]?.kind === 'image');
      const first = imgs[0]?.data.kind === 'asset' ? assets[imgs[0].data.assetId!] : undefined;
      const k = first && first.width > 0 && first.height > 0 ? Math.min(1, 4096 / Math.max(first.width, first.height)) : 0;
      const [w, h] = k ? [Math.round(first!.width * k), Math.round(first!.height * k)] : [1080, 1080];
      const doc = snap?.doc
        ? { ...remapDoc(snap.doc, px!, { newDocId: true, library: link }), name: subject.name }
        : linkedBlankDoc(subject.name, subjectId, curVer, docRev, space === 'studio' ? 'studio' : undefined, w, h);
      const liveExisting = get().sessions[sessionId]?.docs.find((d) => d.id === existing?.id && d.library?.subjectId === subjectId);
      if (liveExisting) detachWorkingDoc(sessionId, liveExisting.id);
      addDoc(sessionId, doc);
      for (const n of imgs) if (n.data.kind === 'asset' && n.data.assetId) await placeKitImage(sessionId, doc.id, n.data.assetId, n.data.title);
      const box = { x: Math.round(w * 0.08), y: Math.round(h * 0.08), width: Math.round(w * 0.84) };
      for (const n of gNodes) if (n.data.kind === 'text' && n.data.text.trim()) addTextLayer(sessionId, doc.id, n.data.text, box, {}, n.data.title || undefined);
      return getDoc(sessionId, doc.id) ?? doc;
    });
  });
}
export const libraryToStudio = (sessionId: string, subjectId: string) => openInSpace(sessionId, subjectId, 'studio');
export const libraryToDesigner = (sessionId: string, subjectId: string) => openInSpace(sessionId, subjectId, 'designer');

export function saveItem(opts: {
  subjectId: string; mode: 'overwrite' | 'copy'; space: LibrarySpace; by: KitActor; sessionId?: string; docId?: string;
  label?: string; name?: string; description?: string; graph?: Graph | ((prev?: Graph) => Graph); kits?: string[]; tokens?: KitTokens;
}): Promise<Subject> {
  return serialize(opts.subjectId, async () => {
    const cur = requireItem(opts.subjectId), kind = cur.kind as KitKind, targetId = opts.mode === 'copy' ? uid('sub') : cur.id;
    const graph = typeof opts.graph === 'function' ? opts.graph(cur.graph) : opts.graph !== undefined ? opts.graph : cur.graph;
    const kits = opts.kits !== undefined ? opts.kits : cur.kits, tokens = opts.tokens !== undefined ? opts.tokens : cur.tokens;
    const checkAssetIds = validateContent(kind, targetId, { graph, kits, tokens, checkAssets: opts.graph !== undefined });
    const session = opts.sessionId ? get().sessions[opts.sessionId] : undefined;
    const workDoc = opts.docId && opts.sessionId ? getDoc(opts.sessionId, opts.docId) : undefined;
    if (opts.docId && !workDoc) throw new Error(`No document "${opts.docId}".`);
    const prevSnap = cur.versionId ? (workDoc ? await readKitVersion(cur.versionId).catch(() => null) : await readKitVersion(cur.versionId)) : null;
    if (!workDoc && cur.versionId && !prevSnap) throw new Error(`Cannot save "${cur.id}": current version "${cur.versionId}" blob is missing.`);
    return withCleanup(async (written) => {
      let storedDoc: DesignDoc | undefined, storedRasterIds: string[] | undefined, docRev: string | undefined;
      if (workDoc || (prevSnap?.doc && opts.mode === 'copy')) {
        if (workDoc) await flushRaster();
        const src = workDoc ?? prevSnap!.doc!;
        const copied = await copyDocPixels(src, workDoc && opts.mode === 'overwrite' ? prevSnap?.doc : null, workDoc ? undefined : expectedRasterIds(prevSnap!), written);
        storedDoc = remapDoc(src, copied.map, { newDocId: false }); storedRasterIds = copied.storedIds; docRev = uid('drev');
      } else if (prevSnap?.doc) {
        for (const rid of expectedRasterIds(prevSnap)) if (!(await blobDb.get(rKey(rid)))) throw new Error(`Missing expected pixel blob "${rKey(rid)}".`);
        storedDoc = prevSnap.doc; storedRasterIds = prevSnap.storedRasterIds ?? rasterBufferIds(prevSnap.doc.layers); docRev = prevSnap.docRev ?? cur.docRev ?? uid('drev');
      }
      const at = Date.now(), targetEntry: Subject = opts.mode === 'copy'
        ? { id: targetId, name: opts.name?.trim() || `${cur.name} copy`, kind, refAssetIds: [], copiedFrom: cur.id, draft: opts.by === 'user' ? false : Boolean(cur.draft), origin: { space: opts.space, by: opts.by, at, ...(session ? { sessionId: session.id, sessionTitle: session.title } : {}) } }
        : cur;
      const saved = await commitVersion(targetEntry, {
        mode: opts.mode === 'copy' ? 'create' : 'append', at, by: opts.by, space: opts.space, label: opts.label,
        name: opts.mode === 'overwrite' && opts.name?.trim() ? opts.name.trim() : undefined,
        description: opts.description !== undefined ? opts.description : (opts.mode === 'copy' ? cur.description : undefined),
        graph, kits, tokens, doc: storedDoc, docRev, storedRasterIds, clearsDraft: opts.by === 'user', checkAssetIds,
      }, written);
      if (opts.mode === 'overwrite' && workDoc && opts.sessionId && workDoc.library?.subjectId === cur.id) {
        setDoc(opts.sessionId, workDoc.id, (d) => d.library?.subjectId === cur.id ? { ...d, library: { ...d.library, versionId: saved.versionId!, ...(docRev ? { docRev } : {}) } } : d);
      }
      return saved;
    });
  });
}

export function restoreItemVersion(opts: { subjectId: string; versionId: string; space: LibrarySpace; by: KitActor; label?: string }): Promise<Subject> {
  return serialize(opts.subjectId, async () => {
    const cur = requireItem(opts.subjectId), snap = await readKitVersion(opts.versionId);
    if (!snap) throw new Error(`Version "${opts.versionId}" blob is missing and cannot be restored.`);
    if (snap.subjectId !== cur.id) throw new Error(`Version "${opts.versionId}" belongs to another Library entry ("${snap.subjectId}").`);
    validateContent(cur.kind as KitKind, cur.id, { graph: snap.graph, kits: snap.kits, tokens: snap.tokens, checkAssets: false });
    if (snap.doc) for (const id of expectedRasterIds(snap)) if (!(await blobDb.get(rKey(id)))) throw new Error(`Cannot restore version "${opts.versionId}": missing pixel blob "${rKey(id)}".`);
    return withCleanup((w) => commitVersion(cur, {
      mode: 'append', at: Date.now(), by: opts.by, space: opts.space, label: opts.label ?? `Restore ${opts.versionId}`,
      graph: snap.graph, kits: snap.kits, tokens: snap.tokens, doc: snap.doc,
      docRev: snap.doc ? (snap.docRev ?? uid('drev')) : undefined, storedRasterIds: snap.storedRasterIds, clearsDraft: opts.by === 'user',
    }, w));
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
