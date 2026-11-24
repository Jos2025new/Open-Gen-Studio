import { uid } from '../lib/id';
import { blobDb } from '../lib/idb';
import { setDoc, useStore } from '../store/store';
import { addDoc, deleteDoc, getDoc, selectDoc } from './design/actions';
import * as D from './design/doc';
import { flushRaster, isUnreadable, pendingRaster, rasterBufferIds } from './design/raster';
import { wouldCreateKitCycle } from './libraryGraph';
import { isKit, type KitActor, type KitKind, type KitLink, type KitPiece, type KitTokens, type KitVersionRef, type LibrarySpace } from './libraryTypes';
import type { DesignDoc, Layer, Subject } from './types';

/* Immutable versioned snapshots (`libver:<id>`) and pixel-safe open/save/restore/delete for Library kits. */

export interface KitVersionSnapshot {
  id: string; subjectId: string; at: number; by: KitActor; space: LibrarySpace;
  label?: string; pieces: KitPiece[]; links: KitLink[]; tokens?: KitTokens; doc?: DesignDoc;
  docRev?: string; storedRasterIds?: string[];
}

const get = useStore.getState;
const rKey = (id: string) => `raster:${id}`;
const vKey = (id: string) => `libver:${id}`;
const queues = new Map<string, Promise<void>>();
const cleanupKeys = (keys: readonly string[]) => (keys.length ? blobDb.delMany([...new Set(keys)]).catch(() => undefined) : Promise.resolve());

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

async function writeVerified(key: string, blob: Blob, expected: Uint8Array, written: string[]): Promise<void> {
  if (await blobDb.get(key)) throw new Error(`Refusing to overwrite existing blob "${key}".`);
  written.push(key);
  await blobDb.set(key, blob);
  const check = await blobDb.get(key);
  if (!check || !sameBytes(expected, new Uint8Array(await check.arrayBuffer()))) {
    throw new Error(`Could not verify saved blob "${key}" (writer lock missing or storage error).`);
  }
}

export async function readKitVersion(versionId: string): Promise<KitVersionSnapshot | null> {
  const blob = await blobDb.get(vKey(versionId));
  if (!blob) return null;
  try { return JSON.parse(await blob.text()) as KitVersionSnapshot; }
  catch { throw new Error(`Version "${versionId}" blob is unreadable.`); }
}

function paintBaseIdsOf(layers: readonly Layer[]): Set<string> {
  const bases = new Set<string>();
  for (const l of layers) {
    if (l.type === 'raster' && l.paintBaseId) bases.add(l.paintBaseId);
    else if (l.type === 'vector' && l.pixelMask?.paintBaseId) bases.add(l.pixelMask.paintBaseId);
  }
  return bases;
}

function rasterRevMap(layers: readonly Layer[]): Map<string, number> {
  const revs = new Map<string, number>();
  for (const l of layers) {
    if (l.type === 'raster') revs.set(l.id, l.rev);
    else if (l.type === 'vector' && l.pixelMask) revs.set(l.pixelMask.id, l.pixelMask.rev);
  }
  return revs;
}

function expectedRasterIds(snap: KitVersionSnapshot): Set<string> {
  if (!snap.doc) return new Set();
  const baseIds = paintBaseIdsOf(snap.doc.layers);
  return snap.storedRasterIds !== undefined ? new Set([...snap.storedRasterIds, ...baseIds]) : new Set(rasterBufferIds(snap.doc.layers));
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
  const groups = rest.groups?.map((g) => ({
    ...g,
    ...(g.keptHidden ? { keptHidden: g.keptHidden.map(remap) } : {}),
    ...(g.keptLocked ? { keptLocked: g.keptLocked.map(remap) } : {}),
  }));
  return { ...rest, ...(groups ? { groups } : {}), id: opts.newDocId ? uid('doc') : rest.id, layers, activeLayerId: rest.activeLayerId ? remap(rest.activeLayerId) : null, ...(opts.library ? { library: opts.library } : {}) };
}

async function copyDocPixels(doc: DesignDoc, reuseFrom: DesignDoc | null | undefined, expectedIds: ReadonlySet<string> | undefined, written: string[]): Promise<{ map: Map<string, string>; storedIds: string[] }> {
  const ids = rasterBufferIds(doc.layers), baseIds = paintBaseIdsOf(doc.layers), revMap = rasterRevMap(doc.layers);
  for (const id of ids) if (isUnreadable(id)) throw new Error(`Cannot save: layer pixels "${id}" are unreadable.`);
  const prevEntries: Array<[string, Uint8Array]> = [];
  if (reuseFrom) {
    for (const pid of rasterBufferIds(reuseFrom.layers)) {
      const b = await blobDb.get(rKey(pid));
      if (b) prevEntries.push([pid, new Uint8Array(await b.arrayBuffer())]);
    }
  }
  const usedPrev = new Set<string>(), map = new Map<string, string>(), storedIds: string[] = [];
  for (const id of ids) {
    const src = await blobDb.get(rKey(id));
    if (!src) {
      const mustExist = baseIds.has(id) || (expectedIds ? expectedIds.has(id) : (revMap.get(id) ?? 0) > 0);
      if (mustExist) throw new Error(`Missing expected pixel blob "${rKey(id)}".`);
      map.set(id, uid('lyr'));
      continue;
    }
    const bytes = new Uint8Array(await src.arrayBuffer());
    const match = prevEntries.find(([pid, pb]) => !usedPrev.has(pid) && sameBytes(bytes, pb));
    if (match) { usedPrev.add(match[0]); map.set(id, match[0]); storedIds.push(match[0]); }
    else {
      const nextId = uid('lyr');
      await writeVerified(rKey(nextId), new Blob([bytes], { type: src.type || 'image/png' }), bytes, written);
      map.set(id, nextId);
      storedIds.push(nextId);
    }
  }
  return { map, storedIds };
}

function validatePieces(pieces: readonly KitPiece[], checkAssets: boolean): void {
  const assets = get().assets;
  for (const p of pieces) {
    if (p.kind === 'asset') {
      if (!p.assetId?.trim()) throw new Error(`Piece "${p.id}" of kind "asset" requires assetId.`);
      if (checkAssets && !assets[p.assetId]) throw new Error(`Piece "${p.id}" references missing asset "${p.assetId}".`);
    } else if (p.kind === 'text') {
      if (!p.text?.trim()) throw new Error(`Piece "${p.id}" of kind "text" requires text.`);
    } else if (p.kind === 'color') {
      if (!p.color?.trim()) throw new Error(`Piece "${p.id}" of kind "color" requires color.`);
    } else if (p.kind === 'kit') {
      if (!p.kitId?.trim()) throw new Error(`Piece "${p.id}" of kind "kit" requires kitId.`);
    }
  }
}

function validateGraph(subjectId: string, pieces: readonly KitPiece[], links: readonly KitLink[], checkAssets: boolean): void {
  validatePieces(pieces, checkAssets);
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

async function writeSnapshot(snap: KitVersionSnapshot, written: string[]): Promise<void> {
  const encoded = new TextEncoder().encode(JSON.stringify(snap));
  await writeVerified(vKey(snap.id), new Blob([encoded], { type: 'application/json' }), encoded, written);
}

function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>).filter(([, val]) => val !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonicalJson(val)}`).join(',')}}`;
}

function docFingerprint(doc: DesignDoc): { json: string; pixelIds: string[] } {
  const map = new Map<string, string>(), pixelIds: string[] = [];
  doc.layers.forEach((l, i) => {
    if (l.type === 'raster') {
      map.set(l.id, `@r${i}`); pixelIds.push(l.id);
      if (l.paintBaseId) { map.set(l.paintBaseId, `@b${i}`); pixelIds.push(l.paintBaseId); }
    } else if (l.type === 'vector' && l.pixelMask) {
      map.set(l.pixelMask.id, `@m${i}`); pixelIds.push(l.pixelMask.id);
      if (l.pixelMask.paintBaseId) { map.set(l.pixelMask.paintBaseId, `@mb${i}`); pixelIds.push(l.pixelMask.paintBaseId); }
    }
  });
  const norm = remapDoc(doc, map, { newDocId: false });
  const { id: _i, createdAt: _c, updatedAt: _u, library: _l, lastExport: _e, activeLayerId: _a, groups, guides, ...rest } = norm;
  const clean = {
    ...rest,
    ...(groups?.length ? { groups } : {}),
    ...(guides && (guides.x.length || guides.y.length) ? { guides } : {}),
  };
  return { json: canonicalJson(clean), pixelIds };
}

async function sameDocContent(workDoc: DesignDoc, baseDoc: DesignDoc, baseSnap: KitVersionSnapshot): Promise<boolean> {
  const a = docFingerprint(workDoc), b = docFingerprint(baseDoc);
  if (a.json !== b.json || a.pixelIds.length !== b.pixelIds.length) return false;
  const expected = expectedRasterIds(baseSnap);
  for (let i = 0; i < a.pixelIds.length; i++) {
    const wId = a.pixelIds[i], bId = b.pixelIds[i];
    const [wBlob, bBlob] = await Promise.all([blobDb.get(rKey(wId)), blobDb.get(rKey(bId))]);
    if (expected.has(bId) && !bBlob) return false;
    if (!wBlob && !bBlob) continue;
    if (!wBlob || !bBlob) return false;
    if (!sameBytes(new Uint8Array(await wBlob.arrayBuffer()), new Uint8Array(await bBlob.arrayBuffer()))) return false;
  }
  return true;
}

function isBlankWorkingDoc(doc: DesignDoc, expectedName?: string): boolean {
  return doc.layers.length === 0 && !(doc.groups?.length) && !(doc.guides && (doc.guides.x.length || doc.guides.y.length))
    && doc.background === null && doc.width === 1080 && doc.height === 1080
    && (expectedName === undefined || doc.name === expectedName);
}

async function isWorkingCopyDirty(doc: DesignDoc): Promise<boolean> {
  if (!doc.library) return true;
  const pending = new Set(pendingRaster());
  for (const rid of rasterBufferIds(doc.layers)) if (pending.has(rid) || isUnreadable(rid)) return true;
  const sub = get().library.find((s) => s.id === doc.library!.subjectId);
  if (!doc.library.versionId) return !isBlankWorkingDoc(doc, sub?.name);
  try {
    const snap = await readKitVersion(doc.library.versionId);
    if (!snap) return true;
    if (!snap.doc) return !isBlankWorkingDoc(doc, sub?.name);
    return !(await sameDocContent(doc, snap.doc, snap));
  } catch {
    return true;
  }
}

const detachedName = (name: string): string => (name.endsWith(' (local copy)') ? name : `${name} (local copy)`);

async function reconcileWorkingDoc(sessionId: string, doc: DesignDoc): Promise<void> {
  if (!(await isWorkingCopyDirty(doc))) deleteDoc(sessionId, doc.id);
  else setDoc(sessionId, doc.id, (d) => { const { library: _drop, ...rest } = d; return { ...rest, name: detachedName(d.name) }; });
}

function linkedBlankDoc(name: string, subjectId: string, versionId: string, docRev?: string, view?: 'studio'): DesignDoc {
  return { ...D.createDoc(name, 1080, 1080, null), library: { subjectId, versionId, ...(docRev ? { docRev } : {}), ...(view ? { view } : {}) } };
}

export async function createKit(opts: {
  name: string; kind: KitKind; space: LibrarySpace; by: KitActor;
  sessionId?: string; description?: string; from?: string[];
  pieces?: KitPiece[]; links?: KitLink[]; tokens?: KitTokens; draft?: boolean;
}): Promise<{ subject: Subject; doc?: DesignDoc }> {
  const name = opts.name.trim();
  if (!name) throw new Error('Kit name is required.');
  const id = uid('sub'), pieces = opts.pieces ?? [], links = opts.links ?? [];
  validateGraph(id, pieces, links, true);
  const session = opts.sessionId ? get().sessions[opts.sessionId] : undefined;
  if (opts.sessionId && !session) throw new Error(`No session "${opts.sessionId}".`);
  const draft = opts.draft ?? (opts.space === 'studio' && Boolean(session)), at = Date.now();
  const baseSubject: Subject = {
    id, name, kind: opts.kind, refAssetIds: [], pieces, links, versions: [],
    ...(opts.description ? { description: opts.description } : {}), ...(opts.tokens ? { tokens: opts.tokens } : {}),
    draft, origin: { space: opts.space, by: opts.by, at, ...(session ? { sessionId: session.id, sessionTitle: session.title } : {}), ...(opts.from?.length ? { from: [...opts.from] } : {}) },
  };
  let subject = baseSubject;
  if (!draft) {
    const written: string[] = [], verId = uid('lv');
    try {
      await writeSnapshot({ id: verId, subjectId: id, at, by: opts.by, space: opts.space, pieces, links, ...(opts.tokens ? { tokens: opts.tokens } : {}) }, written);
      const ref: KitVersionRef = { id: verId, at, by: opts.by, space: opts.space, assetIds: snapshotAssets(baseSubject, pieces) };
      subject = { ...baseSubject, versionId: verId, versions: [ref] };
    } catch (err) {
      await cleanupKeys(written);
      throw err;
    }
  }
  useStore.setState((st) => ({ library: [...st.library, subject] }));
  if (session && opts.space === 'studio') {
    const doc = linkedBlankDoc(name, id, subject.versionId ?? '', subject.docRev, 'studio');
    addDoc(session.id, doc);
    return { subject, doc };
  }
  return { subject };
}

export async function updateKit(id: string, patch: {
  name?: string; description?: string; pieces?: KitPiece[]; links?: KitLink[]; tokens?: KitTokens;
  by?: KitActor; space?: LibrarySpace; label?: string;
}): Promise<Subject> {
  const versioned = patch.pieces !== undefined || patch.links !== undefined || patch.tokens !== undefined;
  const by = patch.by ?? 'user';
  const clearsDraft = patch.name !== undefined && by === 'user';
  if (!versioned) {
    let result: Subject | null = null;
    useStore.setState((st) => {
      const cur = st.library.find((x) => x.id === id);
      if (!cur || !isKit(cur)) return {};
      const name = patch.name !== undefined ? patch.name.trim() : cur.name;
      if (!name) throw new Error('Kit name cannot be empty.');
      result = { ...cur, name, ...(patch.description !== undefined ? { description: patch.description } : {}), draft: clearsDraft ? false : cur.draft, origin: cur.origin };
      return { library: st.library.map((x) => (x.id === id ? result! : x)) };
    });
    if (!result) throw new Error(`No kit "${id}".`);
    return result;
  }
  return serialize(id, async () => {
    const cur = requireKit(id), pieces = patch.pieces ?? cur.pieces ?? [], links = patch.links ?? cur.links ?? [];
    const tokens = patch.tokens !== undefined ? patch.tokens : cur.tokens;
    const name = patch.name !== undefined ? patch.name.trim() : cur.name;
    if (!name) throw new Error('Kit name cannot be empty.');
    validateGraph(id, pieces, links, patch.pieces !== undefined);
    const prevSnap = cur.versionId ? await readKitVersion(cur.versionId) : null;
    if (cur.versionId && !prevSnap) throw new Error(`Cannot update kit "${id}": current version "${cur.versionId}" blob is missing.`);
    const docRev = prevSnap?.doc ? (prevSnap.docRev ?? cur.docRev) : undefined;
    const written: string[] = [], verId = uid('lv'), at = Date.now(), space = patch.space ?? 'library';
    try {
      await writeSnapshot({
        id: verId, subjectId: id, at, by, space, ...(patch.label ? { label: patch.label } : {}),
        pieces, links, ...(tokens ? { tokens } : {}),
        ...(prevSnap?.doc ? { doc: prevSnap.doc, ...(docRev ? { docRev } : {}), ...(prevSnap.storedRasterIds ? { storedRasterIds: prevSnap.storedRasterIds } : {}) } : {}),
      }, written);
      const ref: KitVersionRef = { id: verId, at, by, space, ...(patch.label ? { label: patch.label } : {}), assetIds: snapshotAssets(cur, pieces, prevSnap?.doc), ...(docRev ? { docRev } : {}) };
      let next: Subject | null = null;
      useStore.setState((st) => {
        const live = st.library.find((x) => x.id === id);
        if (!live || !isKit(live)) return {};
        next = {
          ...live, name: patch.name !== undefined ? name : live.name,
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          pieces, links, ...(patch.tokens !== undefined ? { tokens } : {}),
          draft: clearsDraft ? false : live.draft, versionId: verId, ...(docRev ? { docRev } : { docRev: undefined }), versions: [...(live.versions ?? []), ref], origin: live.origin,
        };
        return { library: st.library.map((x) => (x.id === id ? next! : x)) };
      });
      if (!next) throw new Error(`Kit "${id}" was deleted while updating.`);
      return next;
    } catch (err) {
      await cleanupKeys(written);
      throw err;
    }
  });
}

export function openKit(subjectId: string, opts: { sessionId?: string; space: 'studio' | 'designer' }): Promise<DesignDoc> {
  return serialize(subjectId, async () => {
    const subject = requireKit(subjectId), sessionId = opts.sessionId ?? get().activeSessionId, session = get().sessions[sessionId];
    if (!session) throw new Error(`No session "${sessionId}".`);
    const curVer = subject.versionId ?? '', curDocRev = subject.docRev ?? '', existing = session.docs.find((d) => d.library?.subjectId === subjectId);
    if (existing && (existing.library?.docRev ?? '') === curDocRev) {
      if (opts.space === 'designer' && existing.library?.view) {
        setDoc(sessionId, existing.id, (d) => ({ ...d, library: d.library ? { subjectId: d.library.subjectId, versionId: d.library.versionId, ...(d.library.docRev ? { docRev: d.library.docRev } : {}) } : undefined }));
      }
      selectDoc(sessionId, existing.id);
      return getDoc(sessionId, existing.id) ?? existing;
    }
    const snap = curVer ? await readKitVersion(curVer) : null;
    if (curVer && !snap) throw new Error(`Version "${curVer}" blob is missing.`);
    const written: string[] = [];
    try {
      const docRev = snap?.doc ? (snap.docRev ?? subject.docRev) : undefined;
      const link: NonNullable<DesignDoc['library']> = { subjectId, versionId: curVer, ...(docRev ? { docRev } : {}), ...(opts.space === 'studio' ? { view: 'studio' as const } : {}) };
      const doc = snap?.doc
        ? remapDoc(snap.doc, (await copyDocPixels(snap.doc, null, expectedRasterIds(snap), written)).map, { newDocId: true, library: link })
        : linkedBlankDoc(subject.name, subjectId, curVer, docRev, opts.space === 'studio' ? 'studio' : undefined);
      const liveExisting = get().sessions[sessionId]?.docs.find((d) => d.id === existing?.id && d.library?.subjectId === subjectId);
      if (liveExisting) await reconcileWorkingDoc(sessionId, liveExisting);
      addDoc(sessionId, doc);
      return doc;
    } catch (err) {
      await cleanupKeys(written);
      throw err;
    }
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
    validateGraph(targetId, pieces, links, opts.pieces !== undefined);
    const session = opts.sessionId ? get().sessions[opts.sessionId] : undefined;
    const workDoc = opts.docId ? (opts.sessionId ? getDoc(opts.sessionId, opts.docId) : undefined) : session?.docs.find((d) => d.library?.subjectId === cur.id);
    if (opts.docId && !workDoc) throw new Error(`No document "${opts.docId}".`);
    const prevSnap = cur.versionId ? (workDoc ? await readKitVersion(cur.versionId).catch(() => null) : await readKitVersion(cur.versionId)) : null;
    if (!workDoc && cur.versionId && !prevSnap) throw new Error(`Cannot save kit "${cur.id}": current version "${cur.versionId}" blob is missing.`);
    const written: string[] = [];
    try {
      let storedDoc: DesignDoc | undefined, storedRasterIds: string[] | undefined, docRev: string | undefined;
      if (workDoc) {
        await flushRaster();
        const unchanged = opts.mode === 'overwrite' && Boolean(prevSnap?.doc) && await sameDocContent(workDoc, prevSnap!.doc!, prevSnap!);
        const copied = await copyDocPixels(workDoc, opts.mode === 'overwrite' ? prevSnap?.doc : null, undefined, written);
        storedDoc = remapDoc(workDoc, copied.map, { newDocId: false });
        storedRasterIds = copied.storedIds;
        docRev = unchanged ? (prevSnap!.docRev ?? cur.docRev ?? uid('drev')) : uid('drev');
      } else if (prevSnap?.doc) {
        const expected = expectedRasterIds(prevSnap);
        if (opts.mode === 'overwrite') {
          for (const rid of expected) if (!(await blobDb.get(rKey(rid)))) throw new Error(`Missing expected pixel blob "${rKey(rid)}".`);
          storedDoc = prevSnap.doc;
          storedRasterIds = prevSnap.storedRasterIds ?? rasterBufferIds(prevSnap.doc.layers);
          docRev = prevSnap.docRev ?? cur.docRev ?? uid('drev');
        } else {
          const copied = await copyDocPixels(prevSnap.doc, null, expected, written);
          storedDoc = remapDoc(prevSnap.doc, copied.map, { newDocId: false });
          storedRasterIds = copied.storedIds;
          docRev = uid('drev');
        }
      }
      const verId = uid('lv'), at = Date.now();
      await writeSnapshot({ id: verId, subjectId: targetId, at, by: opts.by, space: opts.space, ...(opts.label ? { label: opts.label } : {}), pieces, links, ...(tokens ? { tokens } : {}), ...(storedDoc ? { doc: storedDoc, ...(docRev ? { docRev } : {}), ...(storedRasterIds ? { storedRasterIds } : {}) } : {}) }, written);
      const ref: KitVersionRef = { id: verId, at, by: opts.by, space: opts.space, ...(opts.label ? { label: opts.label } : {}), assetIds: snapshotAssets(cur, pieces, storedDoc), ...(docRev ? { docRev } : {}) };
      let saved: Subject | null = null;
      useStore.setState((st) => {
        const live = st.library.find((x) => x.id === cur.id);
        if (!live || !isKit(live)) return {};
        if (opts.mode === 'copy') {
          saved = {
            id: targetId, name: opts.name?.trim() || `${live.name} copy`, kind: live.kind, refAssetIds: [], pieces, links,
            ...(live.description ? { description: live.description } : {}), ...(tokens ? { tokens } : {}),
            copiedFrom: live.id, draft: opts.by === 'user' ? false : Boolean(live.draft), versionId: verId, ...(docRev ? { docRev } : {}), versions: [ref],
            origin: { space: opts.space, by: opts.by, at, ...(session ? { sessionId: session.id, sessionTitle: session.title } : {}) },
          };
          return { library: [...st.library, saved] };
        }
        saved = {
          ...live,
          pieces: opts.pieces !== undefined ? pieces : live.pieces,
          links: opts.links !== undefined ? links : live.links,
          ...(opts.tokens !== undefined ? { tokens } : {}),
          draft: opts.by === 'user' ? false : live.draft, versionId: verId, ...(docRev ? { docRev } : { docRev: undefined }), versions: [...(live.versions ?? []), ref], origin: live.origin,
        };
        return { library: st.library.map((x) => (x.id === cur.id ? saved! : x)) };
      });
      if (!saved) throw new Error(`Kit "${cur.id}" was deleted while saving.`);
      if (opts.mode === 'overwrite' && workDoc && opts.sessionId && workDoc.library?.subjectId === cur.id) {
        setDoc(opts.sessionId, workDoc.id, (d) => {
          if (!d.library || d.library.subjectId !== cur.id) return d;
          return { ...d, library: { ...d.library, versionId: verId, ...(docRev ? { docRev } : {}) } };
        });
      }
      return saved;
    } catch (err) {
      await cleanupKeys(written);
      throw err;
    }
  });
}

export function restoreKitVersion(opts: { subjectId: string; versionId: string; space: LibrarySpace; by: KitActor; label?: string }): Promise<Subject> {
  return serialize(opts.subjectId, async () => {
    const cur = requireKit(opts.subjectId), snap = await readKitVersion(opts.versionId);
    if (!snap) throw new Error(`Version "${opts.versionId}" blob is missing and cannot be restored.`);
    if (snap.doc) for (const id of expectedRasterIds(snap)) if (!(await blobDb.get(rKey(id)))) throw new Error(`Cannot restore version "${opts.versionId}": missing pixel blob "${rKey(id)}".`);
    const docRev = snap.doc ? (snap.docRev ?? uid('drev')) : undefined;
    const written: string[] = [], verId = uid('lv'), at = Date.now(), label = opts.label ?? `Restore ${opts.versionId}`;
    try {
      await writeSnapshot({ ...snap, id: verId, subjectId: cur.id, at, by: opts.by, space: opts.space, label, ...(docRev ? { docRev } : { docRev: undefined }) }, written);
      const ref: KitVersionRef = { id: verId, at, by: opts.by, space: opts.space, label, assetIds: snapshotAssets(cur, snap.pieces, snap.doc), ...(docRev ? { docRev } : {}) };
      let restored: Subject | null = null;
      useStore.setState((st) => {
        const live = st.library.find((x) => x.id === cur.id);
        if (!live || !isKit(live)) return {};
        restored = { ...live, pieces: snap.pieces, links: snap.links, tokens: snap.tokens, draft: opts.by === 'user' ? false : live.draft, versionId: verId, ...(docRev ? { docRev } : { docRev: undefined }), versions: [...(live.versions ?? []), ref], origin: live.origin };
        return { library: st.library.map((x) => (x.id === cur.id ? restored! : x)) };
      });
      if (!restored) throw new Error(`Kit "${cur.id}" was deleted while restoring.`);
      return restored;
    } catch (err) {
      await cleanupKeys(written);
      throw err;
    }
  });
}

export function deleteKit(id: string): Promise<void> {
  return serialize(id, async () => {
    const live = get().library.find((s) => s.id === id);
    if (!live || !isKit(live)) return;
    for (const [sid, s] of Object.entries(get().sessions)) {
      for (const d of [...s.docs]) if (d.library?.subjectId === id) await reconcileWorkingDoc(sid, d);
    }
    useStore.setState((st) => ({ library: st.library.filter((x) => x.id !== id) }));
    const verIds = [...new Set([...(live.versions ?? []).map((v) => v.id), ...(live.versionId ? [live.versionId] : [])])];
    const keys = new Set<string>();
    for (const vid of verIds) {
      keys.add(vKey(vid));
      const snap = await readKitVersion(vid).catch(() => null);
      if (snap?.doc) for (const rid of rasterBufferIds(snap.doc.layers)) keys.add(rKey(rid));
    }
    if (keys.size) await blobDb.delMany([...keys]).catch(() => undefined);
  });
}
