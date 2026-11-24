import { uid } from '../lib/id';
import { blobDb } from '../lib/idb';
import { setDoc, useStore } from '../store/store';
import { addDoc, getDoc, selectDoc } from './design/actions';
import * as D from './design/doc';
import { flushRaster, isUnreadable, rasterBufferIds } from './design/raster';
import { wouldCreateKitCycle } from './libraryGraph';
import { isKit, type KitActor, type KitKind, type KitLink, type KitPiece, type KitTokens, type KitVersionRef, type LibrarySpace } from './libraryTypes';
import type { DesignDoc, Layer, Subject } from './types';

/* Immutable versioned snapshots (`libver:<id>`) and pixel-safe open/save/restore/delete for Library kits. */

export interface KitVersionSnapshot {
  id: string; subjectId: string; at: number; by: KitActor; space: LibrarySpace;
  label?: string; pieces: KitPiece[]; links: KitLink[]; tokens?: KitTokens; doc?: DesignDoc;
}

const get = useStore.getState;
const rKey = (id: string) => `raster:${id}`;
const vKey = (id: string) => `libver:${id}`;
const queues = new Map<string, Promise<void>>();

function serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(id) ?? Promise.resolve()).then(fn);
  const tail = next.then(() => undefined, () => undefined);
  queues.set(id, tail);
  void tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
  return next;
}

export async function waitKitQueue(id: string): Promise<void> { await queues.get(id); }

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function writeVerified(key: string, blob: Blob, expected: Uint8Array): Promise<void> {
  if (await blobDb.get(key)) throw new Error(`Refusing to overwrite existing blob "${key}".`);
  await blobDb.set(key, blob);
  const check = await blobDb.get(key);
  if (!check || !sameBytes(expected, new Uint8Array(await check.arrayBuffer()))) {
    throw new Error(`Could not verify saved blob "${key}" (writer lock missing or storage error).`);
  }
}

export async function readKitVersion(versionId: string): Promise<KitVersionSnapshot | null> {
  const blob = await blobDb.get(vKey(versionId));
  return blob ? (JSON.parse(await blob.text()) as KitVersionSnapshot) : null;
}

function remapDoc(doc: DesignDoc, map: ReadonlyMap<string, string>, opts: { newDocId: boolean; library?: DesignDoc['library'] }): DesignDoc {
  const { library: _drop, ...rest } = structuredClone(doc);
  const remap = (id: string) => map.get(id) ?? id;
  const layers: Layer[] = rest.layers.map((l) => {
    if (l.type === 'raster') return { ...l, id: remap(l.id), ...(l.paintBaseId ? { paintBaseId: remap(l.paintBaseId) } : {}) };
    if (l.type === 'vector' && l.pixelMask) {
      const m = l.pixelMask;
      return { ...l, pixelMask: { ...m, id: remap(m.id), ...(m.paintBaseId ? { paintBaseId: remap(m.paintBaseId) } : {}) } };
    }
    return l;
  });
  return { ...rest, id: opts.newDocId ? uid('doc') : rest.id, layers, activeLayerId: rest.activeLayerId ? remap(rest.activeLayerId) : null, ...(opts.library ? { library: opts.library } : {}) };
}

async function copyDocPixels(doc: DesignDoc, reuseFrom?: DesignDoc | null): Promise<Map<string, string>> {
  const ids = rasterBufferIds(doc.layers);
  for (const id of ids) if (isUnreadable(id)) throw new Error(`Cannot save: layer pixels "${id}" are unreadable.`);
  const prevEntries: Array<[string, Uint8Array]> = [];
  if (reuseFrom) {
    for (const pid of rasterBufferIds(reuseFrom.layers)) {
      const b = await blobDb.get(rKey(pid));
      if (b) prevEntries.push([pid, new Uint8Array(await b.arrayBuffer())]);
    }
  }
  const usedPrev = new Set<string>(), map = new Map<string, string>();
  for (const id of ids) {
    const src = await blobDb.get(rKey(id));
    if (!src) throw new Error(`Missing expected pixel blob "${rKey(id)}".`);
    const bytes = new Uint8Array(await src.arrayBuffer());
    const match = prevEntries.find(([pid, pb]) => !usedPrev.has(pid) && sameBytes(bytes, pb));
    if (match) { usedPrev.add(match[0]); map.set(id, match[0]); }
    else {
      const nextId = uid('lyr');
      await writeVerified(rKey(nextId), new Blob([bytes], { type: src.type || 'image/png' }), bytes);
      map.set(id, nextId);
    }
  }
  return map;
}

function validateGraph(subjectId: string, pieces: readonly KitPiece[], links: readonly KitLink[]): void {
  const cycle = wouldCreateKitCycle(get().library, subjectId, pieces);
  if (!cycle.ok) throw new Error(cycle.reason);
  const pieceIds = new Set(pieces.map((p) => p.id));
  for (const l of links) if (!pieceIds.has(l.from) || !pieceIds.has(l.to)) throw new Error(`Link "${l.id}" references a missing piece id.`);
}

function snapshotAssets(subject: Subject, pieces: readonly KitPiece[], doc?: DesignDoc): string[] {
  const docAssets = (doc?.layers ?? []).map((l) => ('sourceAssetId' in l ? l.sourceAssetId : undefined));
  const pieceAssets = pieces.map((p) => (p.kind === 'asset' ? p.assetId : undefined));
  return [...new Set([subject.frontalAssetId, ...subject.refAssetIds, subject.videoAssetId, ...pieceAssets, ...docAssets].filter((x): x is string => Boolean(x)))];
}

function requireKit(id: string): Subject {
  const entry = get().library.find((s) => s.id === id);
  if (!entry || !isKit(entry)) throw new Error(`No kit "${id}".`);
  return entry;
}

async function writeSnapshot(snap: KitVersionSnapshot): Promise<void> {
  const encoded = new TextEncoder().encode(JSON.stringify(snap));
  await writeVerified(vKey(snap.id), new Blob([encoded], { type: 'application/json' }), encoded);
}

export function createKit(opts: {
  name: string; kind: KitKind; space: LibrarySpace; by: KitActor;
  sessionId?: string; description?: string; from?: string[];
  pieces?: KitPiece[]; links?: KitLink[]; tokens?: KitTokens; draft?: boolean;
}): { subject: Subject; doc?: DesignDoc } {
  const name = opts.name.trim();
  if (!name) throw new Error('Kit name is required.');
  const id = uid('sub'), pieces = opts.pieces ?? [], links = opts.links ?? [];
  validateGraph(id, pieces, links);
  const session = opts.sessionId ? get().sessions[opts.sessionId] : undefined;
  if (opts.sessionId && !session) throw new Error(`No session "${opts.sessionId}".`);
  const subject: Subject = {
    id, name, kind: opts.kind, refAssetIds: [], pieces, links, versions: [],
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.tokens ? { tokens: opts.tokens } : {}),
    draft: opts.draft ?? (opts.space === 'studio' && Boolean(session)),
    origin: { space: opts.space, by: opts.by, at: Date.now(), ...(session ? { sessionId: session.id, sessionTitle: session.title } : {}), ...(opts.from?.length ? { from: [...opts.from] } : {}) },
  };
  useStore.setState((st) => ({ library: [...st.library, subject] }));
  if (session && opts.space === 'studio') {
    const doc: DesignDoc = { ...D.createDoc(name, 1080, 1080, null), library: { subjectId: id, versionId: '', view: 'studio' } };
    addDoc(session.id, doc);
    return { subject, doc };
  }
  return { subject };
}

export function updateKit(id: string, patch: { name?: string; description?: string; pieces?: KitPiece[]; links?: KitLink[]; tokens?: KitTokens }): Subject {
  const cur = requireKit(id), pieces = patch.pieces ?? cur.pieces ?? [], links = patch.links ?? cur.links ?? [];
  validateGraph(id, pieces, links);
  const name = patch.name !== undefined ? patch.name.trim() : cur.name;
  if (!name) throw new Error('Kit name cannot be empty.');
  const next: Subject = { ...cur, name, pieces, links, ...(patch.description !== undefined ? { description: patch.description } : {}), ...(patch.tokens !== undefined ? { tokens: patch.tokens } : {}), origin: cur.origin };
  useStore.setState((st) => ({ library: st.library.map((x) => (x.id === id ? next : x)) }));
  return next;
}

export function openKit(subjectId: string, opts: { sessionId?: string; space: 'studio' | 'designer' }): Promise<DesignDoc> {
  return serialize(subjectId, async () => {
    const subject = requireKit(subjectId), sessionId = opts.sessionId ?? get().activeSessionId, session = get().sessions[sessionId];
    if (!session) throw new Error(`No session "${sessionId}".`);
    const existing = session.docs.find((d) => d.library?.subjectId === subjectId);
    if (existing) {
      if (opts.space === 'designer' && existing.library?.view) {
        setDoc(sessionId, existing.id, (d) => ({ ...d, library: d.library ? { subjectId: d.library.subjectId, versionId: d.library.versionId } : undefined }));
      }
      selectDoc(sessionId, existing.id);
      return getDoc(sessionId, existing.id) ?? existing;
    }
    const snap = subject.versionId ? await readKitVersion(subject.versionId) : null;
    if (subject.versionId && !snap) throw new Error(`Version "${subject.versionId}" blob is missing.`);
    const link: NonNullable<DesignDoc['library']> = { subjectId, versionId: subject.versionId ?? '', ...(opts.space === 'studio' ? { view: 'studio' as const } : {}) };
    const doc = snap?.doc ? remapDoc(snap.doc, await copyDocPixels(snap.doc, null), { newDocId: true, library: link }) : { ...D.createDoc(subject.name, 1080, 1080, null), library: link };
    addDoc(sessionId, doc);
    return doc;
  });
}

export function saveKit(opts: {
  subjectId: string; mode: 'overwrite' | 'copy'; space: LibrarySpace; by: KitActor;
  sessionId?: string; docId?: string; label?: string; name?: string;
  pieces?: KitPiece[]; links?: KitLink[]; tokens?: KitTokens;
}): Promise<Subject> {
  return serialize(opts.subjectId, async () => {
    const cur = requireKit(opts.subjectId), pieces = opts.pieces ?? cur.pieces ?? [], links = opts.links ?? cur.links ?? [];
    const tokens = opts.tokens !== undefined ? opts.tokens : cur.tokens, targetId = opts.mode === 'copy' ? uid('sub') : cur.id;
    validateGraph(targetId, pieces, links);
    const session = opts.sessionId ? get().sessions[opts.sessionId] : undefined;
    const workDoc = opts.docId && opts.sessionId ? getDoc(opts.sessionId, opts.docId) : session?.docs.find((d) => d.library?.subjectId === cur.id);
    if (opts.docId && !workDoc) throw new Error(`No document "${opts.docId}".`);
    let storedDoc: DesignDoc | undefined;
    const prevSnap = cur.versionId ? await readKitVersion(cur.versionId) : null;
    if (workDoc) {
      await flushRaster();
      storedDoc = remapDoc(workDoc, await copyDocPixels(workDoc, opts.mode === 'overwrite' ? prevSnap?.doc : null), { newDocId: false });
    } else if (prevSnap?.doc) {
      storedDoc = remapDoc(prevSnap.doc, await copyDocPixels(prevSnap.doc, opts.mode === 'overwrite' ? prevSnap.doc : null), { newDocId: false });
    }
    const verId = uid('lv'), at = Date.now();
    await writeSnapshot({ id: verId, subjectId: targetId, at, by: opts.by, space: opts.space, ...(opts.label ? { label: opts.label } : {}), pieces, links, ...(tokens ? { tokens } : {}), ...(storedDoc ? { doc: storedDoc } : {}) });
    const ref: KitVersionRef = { id: verId, at, by: opts.by, space: opts.space, ...(opts.label ? { label: opts.label } : {}), assetIds: snapshotAssets(cur, pieces, storedDoc) };
    if (opts.mode === 'copy') {
      const copy: Subject = {
        id: targetId, name: opts.name?.trim() || `${cur.name} copy`, kind: cur.kind, refAssetIds: [], pieces, links,
        ...(cur.description ? { description: cur.description } : {}), ...(tokens ? { tokens } : {}),
        copiedFrom: cur.id, draft: false, versionId: verId, versions: [ref],
        origin: { space: opts.space, by: opts.by, at, ...(session ? { sessionId: session.id, sessionTitle: session.title } : {}) },
      };
      useStore.setState((st) => ({ library: [...st.library, copy] }));
      return copy;
    }
    const next: Subject = { ...cur, pieces, links, ...(tokens !== undefined ? { tokens } : {}), draft: false, versionId: verId, versions: [...(cur.versions ?? []), ref], origin: cur.origin };
    useStore.setState((st) => ({ library: st.library.map((x) => (x.id === cur.id ? next : x)) }));
    if (workDoc && opts.sessionId && workDoc.library?.subjectId === cur.id) setDoc(opts.sessionId, workDoc.id, (d) => ({ ...d, library: d.library ? { ...d.library, versionId: verId } : undefined }));
    return next;
  });
}

export function restoreKitVersion(opts: { subjectId: string; versionId: string; space: LibrarySpace; by: KitActor; label?: string }): Promise<Subject> {
  return serialize(opts.subjectId, async () => {
    const cur = requireKit(opts.subjectId), snap = await readKitVersion(opts.versionId);
    if (!snap) throw new Error(`Version "${opts.versionId}" blob is missing and cannot be restored.`);
    if (snap.doc) for (const id of rasterBufferIds(snap.doc.layers)) if (!(await blobDb.get(rKey(id)))) throw new Error(`Cannot restore version "${opts.versionId}": missing pixel blob "${rKey(id)}".`);
    const verId = uid('lv'), at = Date.now(), label = opts.label ?? `Restore ${opts.versionId}`;
    await writeSnapshot({ ...snap, id: verId, subjectId: cur.id, at, by: opts.by, space: opts.space, label });
    const ref: KitVersionRef = { id: verId, at, by: opts.by, space: opts.space, label, assetIds: snapshotAssets(cur, snap.pieces, snap.doc) };
    const next: Subject = { ...cur, pieces: snap.pieces, links: snap.links, tokens: snap.tokens, draft: false, versionId: verId, versions: [...(cur.versions ?? []), ref], origin: cur.origin };
    useStore.setState((st) => ({ library: st.library.map((x) => (x.id === cur.id ? next : x)) }));
    return next;
  });
}

export function unlinkKitDocs(subjectId: string): void {
  useStore.setState((st) => {
    let changed = false;
    const sessions = { ...st.sessions };
    for (const [sid, s] of Object.entries(st.sessions)) {
      if (!s.docs.some((d) => d.library?.subjectId === subjectId)) continue;
      changed = true;
      sessions[sid] = { ...s, docs: s.docs.map((d) => (d.library?.subjectId === subjectId ? (({ library: _l, ...rest }) => rest)(d) : d)) };
    }
    return changed ? { sessions } : {};
  });
}

export function purgeKitBlobs(subject: Subject): Promise<void> {
  return serialize(subject.id, async () => {
    const verIds = [...new Set([...(subject.versions ?? []).map((v) => v.id), ...(subject.versionId ? [subject.versionId] : [])])];
    const keys = new Set<string>();
    for (const vid of verIds) {
      keys.add(vKey(vid));
      const snap = await readKitVersion(vid).catch(() => null);
      if (snap?.doc) for (const rid of rasterBufferIds(snap.doc.layers)) keys.add(rKey(rid));
    }
    if (keys.size) await blobDb.delMany([...keys]).catch(() => undefined);
  });
}
