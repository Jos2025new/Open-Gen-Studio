import { setDoc, setSettings, useStore } from '../store/store';
import { brandSlotFile, brandSlug, linkedBrandHref, syncBrandExportFolder, type BrandExportFolderResult, type BrandSlotFile } from './brandExportFolder';
import { assetCanvas, getDoc, placeAsset } from './design/actions';
import * as D from './design/doc';
import { liveGroups } from './design/groups';
import { record } from './design/history';
import { cloneCanvas, deleteBuffers, ensureBuffers, rasterBufferIds, releaseBuffers, restoreBuffers, setBuffer, snapshotBuffers } from './design/raster';
import { markTokenSyncDone, onAutoTokenSync, syncTokens } from './design/tokenBind';
import { cloneComponentLayer } from './libraryInsert';
import { isKit, type LibraryAssetRef, type TokenRef } from './libraryTypes';
import { cleanupKeys, copyDocPixels, expectedRasterIds, readKitVersion } from './libraryVersions';
import type { DesignDoc, GraphNode, Layer, LayerGroup, RasterLayer, Subject, TextLayer, VectorLayer, VectorShape } from './types';

export { brandSlotFile, brandSlug, linkedBrandHref as linkedSvgHref, syncBrandExportFolder, type BrandExportFolderResult, type BrandSlotFile };

/* Linked brand assets (logos), component instance sync, and corner notice with surgical undoable revert. */

function slotOf(subject: Subject | undefined, nodeId: string): { node: GraphNode; assetId: string; title: string } | null {
  const node = subject?.graph?.nodes.find((n) => n.id === nodeId && n.data.kind === 'asset' && n.data.assetId);
  if (!node || node.data.kind !== 'asset' || !node.data.assetId) return null;
  return { node, assetId: node.data.assetId, title: node.data.title || 'Logo' };
}

/** Places a Brand Kit image slot into a Designer document as a linked raster layer that follows slot replacements. */
export async function placeLinkedAsset(sessionId: string, docId: string, subjectId: string, nodeId: string, target: 'base' | 'new' = 'new'): Promise<string | null> {
  const st = useStore.getState();
  const kit = st.library.find((s) => s.id === subjectId && isKit(s));
  const slot = slotOf(kit, nodeId);
  if (!kit || !slot) throw new Error(`No image slot "${nodeId}" in Library item "${subjectId}".`);
  const layerId = await placeAsset(sessionId, docId, slot.assetId, target, slot.title);
  if (!layerId) return null;
  const file = brandSlotFile(kit, nodeId, st.assets, slot.title, slot.assetId);
  const ref: LibraryAssetRef = { subjectId, nodeId, assetId: slot.assetId, slug: file.slug, filename: file.filename };
  setDoc(sessionId, docId, (d) => D.updateLayer(d, layerId, { libraryAsset: ref } as Partial<RasterLayer>));
  return layerId;
}

export interface PendingBrandSummary { tokens: number; logos: number; components: number; total: number; kits: string[] }

/** Counts pending token, linked-logo and component updates across all designs of a session. */
export function pendingBrandUpdates(sessionId: string, st = useStore.getState()): PendingBrandSummary {
  const session = st.sessions[sessionId];
  if (!session) return { tokens: 0, logos: 0, components: 0, total: 0, kits: [] };
  const kits = new Set<string>();
  let tokens = 0, logos = 0, components = 0;
  for (const doc of session.docs) {
    const tokChanged = new Set<string>();
    syncTokens(doc, st.library, { changed: tokChanged });
    tokens += tokChanged.size;
    for (const l of doc.layers) {
      if (l.type !== 'raster' || !l.libraryAsset) continue;
      const kit = st.library.find((s) => s.id === l.libraryAsset!.subjectId);
      const slot = slotOf(kit, l.libraryAsset.nodeId);
      if (kit && slot && slot.assetId !== l.libraryAsset.assetId) { logos++; kits.add(kit.name); }
    }
    for (const g of liveGroups(doc)) {
      if (!g.from) continue;
      const kit = st.library.find((s) => s.id === g.from!.subjectId);
      if (kit?.versionId && kit.versionId !== g.from.versionId && (!kit.groupIds || kit.groupIds.includes(g.from.pieceId))) {
        components++;
        kits.add(kit.name);
      }
    }
  }
  return { tokens, logos, components, total: tokens + logos + components, kits: [...kits] };
}

export interface BrandSyncNoticeState {
  id: number;
  sessionId: string;
  summary: string;
  at: number;
  canRevert: boolean;
}

interface LayerRevert { layerId: string; before: Layer; after: Layer }
interface GroupRevert { groupId: string; beforeGroup: LayerGroup; beforeMembers: Layer[]; afterMemberIds: string[]; writtenBlobKeys: string[] }
interface DocRevertPatch {
  docId: string;
  backgroundBefore?: { background: string | null; backgroundToken?: TokenRef };
  backgroundAfter?: { background: string | null; backgroundToken?: TokenRef };
  layers: Map<string, LayerRevert>;
  groups: Map<string, GroupRevert>;
}
interface RevertPayload {
  sessionId: string;
  changedNames: string[];
  patches: Map<string, DocRevertPatch>;
  buffers: Map<string, HTMLCanvasElement>;
  libraryRef?: readonly Subject[];
}

const RASTER_SYNC_KEYS: ReadonlyArray<keyof RasterLayer> = ['width', 'height', 'pxWidth', 'pxHeight', 'rev', 'sourceAssetId', 'libraryAsset', 'widthToken'];
const TEXT_SYNC_KEYS: ReadonlyArray<keyof TextLayer> = ['color', 'colorToken', 'colorOpacity', 'fontFamily', 'fontFamilyToken', 'fontSize', 'fontSizeToken'];
const SHAPE_SYNC_KEYS: ReadonlyArray<keyof VectorShape> = ['fill', 'fillToken', 'fillOpacity', 'stroke', 'strokeToken', 'strokeOpacity', 'radius', 'rx', 'ry', 'radiusToken', 'w', 'widthToken', 'fillGradient', 'strokeGradient'];

function sameVal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function emptyDocPatch(docId: string): DocRevertPatch {
  return { docId, layers: new Map(), groups: new Map() };
}

function recordLayerPatch(patch: DocRevertPatch, before: Layer, after: Layer): void {
  const prev = patch.layers.get(before.id);
  patch.layers.set(before.id, { layerId: before.id, before: prev ? prev.before : before, after });
}

function diffDocForTokens(prev: DesignDoc, next: DesignDoc): DocRevertPatch | null {
  const patch = emptyDocPatch(prev.id);
  let any = false;
  if (prev.background !== next.background || !sameVal(prev.backgroundToken, next.backgroundToken)) {
    patch.backgroundBefore = { background: prev.background, backgroundToken: prev.backgroundToken };
    patch.backgroundAfter = { background: next.background, backgroundToken: next.backgroundToken };
    any = true;
  }
  const prevById = new Map(prev.layers.map((l) => [l.id, l]));
  for (const nextL of next.layers) {
    const prevL = prevById.get(nextL.id);
    if (prevL && prevL !== nextL) {
      recordLayerPatch(patch, prevL, nextL);
      any = true;
    }
  }
  return any ? patch : null;
}

function revertFields<T extends object>(cur: T, before: T, after: T, keys: ReadonlyArray<keyof T>): T {
  let out: T | null = null;
  for (const k of keys) {
    if (sameVal(before[k], after[k])) continue;
    if (!out) out = { ...cur };
    out[k] = before[k];
  }
  return out ?? cur;
}

function revertLayerSurgical(cur: Layer, before: Layer, after: Layer): Layer {
  if (cur.type !== before.type || cur.type !== after.type) return cur;
  if (cur.type === 'raster') return revertFields(cur, before as RasterLayer, after as RasterLayer, RASTER_SYNC_KEYS);
  if (cur.type === 'text') return revertFields(cur, before as TextLayer, after as TextLayer, TEXT_SYNC_KEYS);
  if (cur.type === 'vector') {
    const bVec = before as VectorLayer, aVec = after as VectorLayer;
    const bShapes = new Map(bVec.shapes.map((s) => [s.id, s]));
    const aShapes = new Map(aVec.shapes.map((s) => [s.id, s]));
    let shapesChanged = false;
    const shapes = cur.shapes.map((s) => {
      const bs = bShapes.get(s.id), as = aShapes.get(s.id);
      if (!bs || !as || bs === as) return s;
      const next = revertFields(s, bs, as, SHAPE_SYNC_KEYS);
      if (next !== s) shapesChanged = true;
      return next;
    });
    let strokesChanged = false;
    let strokes = cur.strokes;
    if (cur.strokes && bVec.strokes && aVec.strokes) {
      const bSt = new Map(bVec.strokes.map((s) => [s.id, s]));
      const aSt = new Map(aVec.strokes.map((s) => [s.id, s]));
      strokes = cur.strokes.map((st) => {
        const bs = bSt.get(st.id), as = aSt.get(st.id);
        if (!bs || !as || bs === as) return st;
        const next = revertFields(st, bs, as, ['color', 'colorToken', 'opacity']);
        if (next !== st) strokesChanged = true;
        return next;
      });
    }
    return shapesChanged || strokesChanged ? { ...cur, shapes, ...(strokes ? { strokes } : {}) } : cur;
  }
  return cur;
}

function mergeDocPatches(base: DocRevertPatch, extra: DocRevertPatch): DocRevertPatch {
  const out: DocRevertPatch = {
    docId: base.docId,
    backgroundBefore: base.backgroundBefore ?? extra.backgroundBefore,
    backgroundAfter: extra.backgroundAfter ?? base.backgroundAfter,
    layers: new Map(base.layers),
    groups: new Map(base.groups),
  };
  for (const [id, lr] of extra.layers) {
    const prev = out.layers.get(id);
    out.layers.set(id, prev ? { layerId: id, before: prev.before, after: lr.after } : lr);
  }
  for (const [gid, gr] of extra.groups) {
    const prev = out.groups.get(gid);
    out.groups.set(gid, prev ? {
      groupId: gid,
      beforeGroup: prev.beforeGroup,
      beforeMembers: prev.beforeMembers,
      afterMemberIds: gr.afterMemberIds,
      writtenBlobKeys: [...prev.writtenBlobKeys, ...gr.writtenBlobKeys],
    } : gr);
  }
  return out;
}

function formatSummary(changedNames: string[]): string {
  const unique = [...new Set(changedNames)];
  if (!unique.length) return '';
  return `Diseño actualizado (${unique.slice(0, 3).join(', ')}${unique.length > 3 ? ` +${unique.length - 3}` : ''})`;
}

let currentNotice: BrandSyncNoticeState | null = null;
let revertPayload: RevertPayload | null = null;
let noticeSeq = 0;
const listeners = new Set<() => void>();
const emitNotice = () => { for (const fn of listeners) fn(); };

export function subscribeBrandSyncNotice(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getBrandSyncNotice(): BrandSyncNoticeState | null { return currentNotice; }
export function dismissBrandSyncNotice(): void { currentNotice = null; revertPayload = null; emitNotice(); }

function postNotice(sessionId: string, summary: string, revert?: RevertPayload, mergeLibrary?: readonly Subject[]): void {
  if (mergeLibrary && revert && revertPayload && revertPayload.sessionId === sessionId && revertPayload.libraryRef === mergeLibrary) {
    const mergedNames = [...new Set([...revertPayload.changedNames, ...revert.changedNames])];
    const mergedPatches = new Map(revertPayload.patches);
    for (const [docId, patch] of revert.patches) {
      const existing = mergedPatches.get(docId);
      mergedPatches.set(docId, existing ? mergeDocPatches(existing, patch) : patch);
    }
    const mergedBuffers = new Map(revertPayload.buffers);
    for (const [id, canvas] of revert.buffers) {
      if (!mergedBuffers.has(id)) mergedBuffers.set(id, canvas);
    }
    revertPayload = { sessionId, changedNames: mergedNames, patches: mergedPatches, buffers: mergedBuffers, libraryRef: mergeLibrary };
    currentNotice = { id: ++noticeSeq, sessionId, summary: formatSummary(mergedNames), at: Date.now(), canRevert: true };
    emitNotice();
    return;
  }
  currentNotice = { id: ++noticeSeq, sessionId, summary, at: Date.now(), canRevert: Boolean(revert) };
  revertPayload = revert ?? null;
  emitNotice();
}

/** Reverts the last automatic or manual brand propagation surgically, preserving later user edits and recording an undo step. */
export function revertBrandSyncNotice(): boolean {
  if (!revertPayload) return false;
  const { sessionId, patches, buffers } = revertPayload;
  revertPayload = null;
  currentNotice = null;

  const docsToApply: Array<{ docId: string; next: DesignDoc }> = [];
  const deadComponentBufIds: string[] = [];
  const writtenBlobKeys: string[] = [];

  for (const patch of patches.values()) {
    const current = getDoc(sessionId, patch.docId);
    if (!current) continue;
    // Record current state BEFORE reverting so even "Volver al anterior" can be undone with Ctrl+Z.
    record(current);

    let nextLayers = current.layers.map((l) => {
      const lr = patch.layers.get(l.id);
      return lr ? revertLayerSurgical(l, lr.before, lr.after) : l;
    });
    let nextGroups = current.groups ? [...current.groups] : undefined;

    for (const gr of patch.groups.values()) {
      const afterSet = new Set(gr.afterMemberIds);
      const removed = nextLayers.filter((l) => afterSet.has(l.id));
      deadComponentBufIds.push(...rasterBufferIds(removed));
      writtenBlobKeys.push(...gr.writtenBlobKeys);
      const firstIdx = nextLayers.findIndex((l) => afterSet.has(l.id));
      const kept = nextLayers.filter((l) => !afterSet.has(l.id));
      const at = firstIdx >= 0 ? Math.min(firstIdx, kept.length) : kept.length;
      kept.splice(at, 0, ...gr.beforeMembers);
      nextLayers = kept;
      if (nextGroups) {
        const has = nextGroups.some((g) => g.id === gr.groupId);
        nextGroups = has ? nextGroups.map((g) => (g.id === gr.groupId ? gr.beforeGroup : g)) : [...nextGroups, gr.beforeGroup];
      } else {
        nextGroups = [gr.beforeGroup];
      }
    }

    const bgPatch = patch.backgroundBefore && current.background === patch.backgroundAfter?.background
      ? { background: patch.backgroundBefore.background, backgroundToken: patch.backgroundBefore.backgroundToken }
      : {};

    docsToApply.push({
      docId: current.id,
      next: { ...current, ...bgPatch, updatedAt: Date.now(), layers: nextLayers, ...(nextGroups ? { groups: nextGroups } : {}) },
    });
  }

  const lib = useStore.getState().library;
  if (buffers.size) restoreBuffers(buffers);
  for (const { docId, next } of docsToApply) {
    markTokenSyncDone(next, lib);
    setDoc(sessionId, docId, () => next);
  }
  if (deadComponentBufIds.length) void deleteBuffers([...new Set(deadComponentBufIds)]);
  if (writtenBlobKeys.length) void cleanupKeys([...new Set(writtenBlobKeys)]);
  emitNotice();
  return docsToApply.length > 0;
}

export function setBrandSyncMode(mode: 'auto' | 'manual'): void {
  setSettings({ brandSyncMode: mode });
  if (mode === 'manual' && currentNotice) dismissBrandSyncNotice();
}

function componentChanged(prevDoc: DesignDoc | undefined, nextDoc: DesignDoc, pieceId: string): boolean {
  if (!prevDoc) return true;
  const prevGroup = (prevDoc.groups ?? []).find((x) => x.id === pieceId);
  const nextGroup = (nextDoc.groups ?? []).find((x) => x.id === pieceId);
  if (!prevGroup || !nextGroup) return true;
  const prevLayers = prevDoc.layers.filter((l) => l.groupId === pieceId);
  const nextLayers = nextDoc.layers.filter((l) => l.groupId === pieceId);
  const normGroup = (g: LayerGroup) => ({ name: g.name, keptHidden: g.keptHidden, keptLocked: g.keptLocked });
  return JSON.stringify(normGroup(prevGroup)) !== JSON.stringify(normGroup(nextGroup)) || JSON.stringify(prevLayers) !== JSON.stringify(nextLayers);
}

export interface BrandSyncResult { docsUpdated: number; logosUpdated: number; componentsUpdated: number; tokensUpdated: number; summary: string }

/** Propagates updated linked logos, component instances and (optionally) tokens from Library kits to designs in a session. */
export async function syncBrandInSession(
  sessionId: string,
  opts: { docId?: string; includeTokens?: boolean; recordNotice?: boolean; mergeLibrary?: readonly Subject[] } = {},
): Promise<BrandSyncResult> {
  const st = useStore.getState(), session = st.sessions[sessionId];
  if (!session) return { docsUpdated: 0, logosUpdated: 0, componentsUpdated: 0, tokensUpdated: 0, summary: '' };
  const targetDocs = opts.docId ? session.docs.filter((d) => d.id === opts.docId) : session.docs;
  const patches = new Map<string, DocRevertPatch>();
  const revertBuffers = new Map<string, HTMLCanvasElement>();
  const replacedBufIds: string[] = [];
  const changedNames: string[] = [];
  let docsUpdated = 0, logosUpdated = 0, componentsUpdated = 0, tokensUpdated = 0;

  for (const doc0 of targetDocs) {
    let doc = doc0, touched = false, versionBumpedOnly = false;
    const docPatch = emptyDocPatch(doc0.id);

    if (opts.includeTokens) {
      const tokChanged = new Set<string>();
      const next = syncTokens(doc, st.library, { changed: tokChanged });
      if (next !== doc) {
        const tokPatch = diffDocForTokens(doc, next);
        if (tokPatch) {
          docPatch.backgroundBefore = tokPatch.backgroundBefore;
          docPatch.backgroundAfter = tokPatch.backgroundAfter;
          for (const [id, lr] of tokPatch.layers) docPatch.layers.set(id, lr);
        }
        doc = next; touched = true; tokensUpdated += tokChanged.size;
        for (const t of tokChanged) changedNames.push(`token ${t}`);
      }
    }

    // 1. Linked raster logos / images
    const logoUpdates: Array<{ layer: RasterLayer; assetId: string; title: string; slug: string; filename: string }> = [];
    for (const l of doc.layers) {
      if (l.type !== 'raster' || !l.libraryAsset) continue;
      const kit = st.library.find((s) => s.id === l.libraryAsset!.subjectId);
      const slot = slotOf(kit, l.libraryAsset.nodeId);
      if (kit && slot && slot.assetId !== l.libraryAsset.assetId) {
        const file = brandSlotFile(kit, l.libraryAsset.nodeId, st.assets, slot.title, slot.assetId);
        logoUpdates.push({ layer: l, assetId: slot.assetId, title: slot.title, slug: file.slug, filename: file.filename });
      }
    }
    if (logoUpdates.length) {
      // Load and snapshot v1 buffers BEFORE overwriting with v2 so Revert restores real v1 pixels.
      await ensureBuffers(logoUpdates.map((u) => u.layer));
      for (const [id, c] of snapshotBuffers(logoUpdates.map((u) => u.layer.id))) {
        if (!revertBuffers.has(id)) revertBuffers.set(id, cloneCanvas(c));
      }
      for (const u of logoUpdates) {
        const canvas = await assetCanvas(u.assetId).catch(() => null);
        if (!canvas) continue;
        const beforeLayer = doc.layers.find((x) => x.id === u.layer.id) as RasterLayer | undefined;
        if (!beforeLayer) continue;
        const nextWidth = beforeLayer.width > 0 ? beforeLayer.width : canvas.width;
        const nextHeight = canvas.width > 0 ? Math.max(1, Math.round((nextWidth * canvas.height) / canvas.width)) : beforeLayer.height;
        setBuffer(beforeLayer.id, canvas);
        doc = D.updateLayer(doc, beforeLayer.id, {
          width: nextWidth, height: nextHeight, pxWidth: canvas.width, pxHeight: canvas.height,
          rev: beforeLayer.rev + 1, sourceAssetId: u.assetId,
          libraryAsset: { ...beforeLayer.libraryAsset!, assetId: u.assetId, slug: u.slug, filename: u.filename },
        } as Partial<RasterLayer>);
        const afterLayer = doc.layers.find((x) => x.id === beforeLayer.id);
        if (afterLayer) recordLayerPatch(docPatch, beforeLayer, afterLayer);
        touched = true; logosUpdated++; changedNames.push(`logo «${u.title}»`);
      }
    }

    // 2. Component group instances
    const outdatedGroups = liveGroups(doc).filter((g) => {
      if (!g.from) return false;
      const kit = st.library.find((s) => s.id === g.from!.subjectId);
      return Boolean(kit?.versionId && kit.versionId !== g.from.versionId && (!kit.groupIds || kit.groupIds.includes(g.from.pieceId)));
    });
    for (const g of outdatedGroups) {
      const kit = st.library.find((s) => s.id === g.from!.subjectId);
      if (!kit?.versionId) continue;
      const snap = await readKitVersion(kit.versionId).catch(() => null);
      if (!snap?.doc) continue;
      const srcGroup = (snap.doc.groups ?? []).find((x) => x.id === g.from!.pieceId);
      const srcLayers = snap.doc.layers.filter((l) => l.groupId === g.from!.pieceId);
      if (!srcGroup || !srcLayers.length) continue;

      const prevSnap = g.from!.versionId ? await readKitVersion(g.from!.versionId).catch(() => null) : null;
      if (!componentChanged(prevSnap?.doc, snap.doc, g.from!.pieceId)) {
        // Component itself did not change (e.g. only a token was saved on the kit): bump versionId without clobbering local edits.
        doc = { ...doc, groups: liveGroups(doc).map((x) => (x.id === g.id ? { ...x, from: { ...x.from!, versionId: kit.versionId! } } : x)) };
        versionBumpedOnly = true;
        continue;
      }

      const curMembers = doc.layers.filter((l) => l.groupId === g.id);
      const curBox = D.unionBox(curMembers.map(D.approxLayerBox).filter((b): b is D.Box => b != null));
      const written: string[] = [];
      try {
        await ensureBuffers(curMembers);
        const curBufIds = rasterBufferIds(curMembers);
        for (const [id, c] of snapshotBuffers(curBufIds)) {
          if (!revertBuffers.has(id)) revertBuffers.set(id, cloneCanvas(c));
        }
        const copied = await copyDocPixels({ ...snap.doc, layers: srcLayers }, null, expectedRasterIds(snap), written);
        const idMap = new Map<string, string>();
        let nextLayers = srcLayers.map((l) => { const n = cloneComponentLayer(l, g.id, copied.map); idMap.set(l.id, n.id); return n; });
        const srcBox = D.unionBox(nextLayers.map(D.approxLayerBox).filter((b): b is D.Box => b != null));
        if (curBox && srcBox) nextLayers = nextLayers.map((l) => D.translateLayer(l, curBox.x - srcBox.x, curBox.y - srcBox.y));
        // Reapply tokens on the newly cloned component layers so the target doc's tokenMode is respected.
        nextLayers = syncTokens({ ...doc, layers: nextLayers }, st.library).layers;
        const firstIdx = doc.layers.findIndex((l) => l.groupId === g.id);
        const kept = doc.layers.filter((l) => l.groupId !== g.id);
        const at = firstIdx >= 0 ? Math.min(firstIdx, kept.length) : kept.length;
        kept.splice(at, 0, ...nextLayers);
        const updatedGroup: LayerGroup = {
          ...g, name: srcGroup.name, from: { ...g.from!, versionId: kit.versionId },
          ...(srcGroup.keptHidden ? { keptHidden: srcGroup.keptHidden.map((id) => idMap.get(id) ?? id) } : { keptHidden: undefined }),
          ...(srcGroup.keptLocked ? { keptLocked: srcGroup.keptLocked.map((id) => idMap.get(id) ?? id) } : { keptLocked: undefined }),
        };
        doc = { ...doc, updatedAt: Date.now(), layers: kept, groups: liveGroups(doc).map((x) => (x.id === g.id ? updatedGroup : x)) };
        docPatch.groups.set(g.id, {
          groupId: g.id,
          beforeGroup: g,
          beforeMembers: curMembers,
          afterMemberIds: nextLayers.map((l) => l.id),
          writtenBlobKeys: [...written],
        });
        replacedBufIds.push(...curBufIds);
        touched = true; componentsUpdated++; changedNames.push(`componente «${srcGroup.name}»`);
      } catch {
        await cleanupKeys(written);
      }
    }

    if (touched) {
      patches.set(doc0.id, docPatch);
      setDoc(sessionId, doc0.id, () => doc);
      docsUpdated++;
    } else if (versionBumpedOnly) {
      setDoc(sessionId, doc0.id, () => doc);
    }
  }

  if (replacedBufIds.length) {
    const allLive = new Set(Object.values(useStore.getState().sessions).flatMap((s) => s.docs.flatMap((d) => rasterBufferIds(d.layers))));
    const dead = [...new Set(replacedBufIds)].filter((id) => !allLive.has(id));
    if (dead.length) {
      releaseBuffers(allLive, dead);
      void deleteBuffers(dead);
    }
  }

  const summary = docsUpdated ? formatSummary(changedNames) : '';
  if (docsUpdated && opts.recordNotice !== false) {
    const payload: RevertPayload = { sessionId, changedNames: [...new Set(changedNames)], patches, buffers: revertBuffers, libraryRef: opts.mergeLibrary };
    postNotice(sessionId, summary, payload, opts.mergeLibrary);
  }
  return { docsUpdated, logosUpdated, componentsUpdated, tokensUpdated, summary };
}

/** Installs automatic brand propagation (linked logos, components and token-sync corner notices). */
export function installBrandSync(): () => void {
  let running = false;
  let queued = false;

  const trigger = (mergeLibrary?: readonly Subject[]) => {
    const st = useStore.getState();
    if (st.settings.brandSyncMode === 'manual') return;
    const sessionId = st.activeSessionId;
    if (!sessionId) return;
    const pending = pendingBrandUpdates(sessionId, st);
    if (!pending.logos && !pending.components) return;
    if (running) { queued = true; return; }
    running = true;
    queued = false;
    void syncBrandInSession(sessionId, { includeTokens: false, recordNotice: true, mergeLibrary }).finally(() => {
      running = false;
      if (queued) {
        queued = false;
        trigger(useStore.getState().library);
      }
    });
  };

  onAutoTokenSync(({ sessionId, tokens, prevDocs, nextDocs, library }) => {
    const patches = new Map<string, DocRevertPatch>();
    for (let i = 0; i < prevDocs.length; i++) {
      const p = diffDocForTokens(prevDocs[i], nextDocs[i]);
      if (p) patches.set(prevDocs[i].id, p);
    }
    if (!patches.size) return;
    const changedNames = tokens.map((t) => `token ${t}`);
    const label = tokens.slice(0, 3).join(', ') + (tokens.length > 3 ? ` +${tokens.length - 3}` : '');
    const summary = `Diseño actualizado con ${tokens.length === 1 ? `el token «${label}»` : `los tokens ${label}`}`;
    postNotice(sessionId, summary, { sessionId, changedNames, patches, buffers: new Map(), libraryRef: library }, library);
  });

  const unsub = useStore.subscribe((st, prev) => {
    const libChanged = st.library !== prev.library;
    const sessionChanged = st.activeSessionId !== prev.activeSessionId;
    const modeChanged = st.settings.brandSyncMode !== prev.settings.brandSyncMode;
    if (!libChanged && !sessionChanged && !modeChanged) return;
    if (st.settings.brandSyncMode === 'manual') {
      if (modeChanged && currentNotice) dismissBrandSyncNotice();
      return;
    }
    trigger(st.library);
  });
  return () => { unsub(); onAutoTokenSync(null); };
}
