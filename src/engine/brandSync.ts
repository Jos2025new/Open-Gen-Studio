import { setDoc, setSettings, useStore } from '../store/store';
import { brandSlotFile, brandSlug, linkedBrandHref, syncBrandExportFolder, type BrandExportFolderResult, type BrandSlotFile } from './brandExportFolder';
import { componentChanged, diffDocForTokens, emptyDocPatch, mergeDocPatches, preserveLocalTextOverrides, recordLayerPatch, revertLayerSurgical, sameVal, type DocRevertPatch } from './brandSyncDiff';
import { assetCanvas, getDoc, placeAsset } from './design/actions';
import * as D from './design/doc';
import { liveGroups } from './design/groups';
import { record } from './design/history';
import { cloneCanvas, deleteBuffers, ensureBuffers, rasterBufferIds, releaseBuffers, restoreBuffers, setBuffer, snapshotBuffers } from './design/raster';
import { markTokenSyncDone, onAutoTokenSync, syncTokens } from './design/tokenBind';
import { cloneComponentLayer } from './libraryInsert';
import { isKit, type LibraryAssetRef } from './libraryTypes';
import { cleanupKeys, copyDocPixels, expectedRasterIds, readKitVersion } from './libraryVersions';
import type { DesignDoc, GraphNode, Layer, LayerGroup, RasterLayer, Subject } from './types';

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

interface RevertPayload {
  sessionId: string;
  changedNames: string[];
  patches: Map<string, DocRevertPatch>;
  buffers: Map<string, HTMLCanvasElement>;
  libraryRef?: readonly Subject[];
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
  const buffersToRestore = new Map<string, HTMLCanvasElement>();
  const deadComponentBufIds: string[] = [];
  const writtenBlobKeys: string[] = [];

  for (const patch of patches.values()) {
    const current = getDoc(sessionId, patch.docId);
    if (!current) continue;
    // Record current state BEFORE reverting so even "Volver al anterior" can be undone with Ctrl+Z.
    record(current);

    const restoredLayerIds = new Set<string>();
    let nextLayers = current.layers.map((l) => {
      const lr = patch.layers.get(l.id);
      if (!lr) return l;
      const reverted = revertLayerSurgical(l, lr.before, lr.after);
      if (reverted !== l) restoredLayerIds.add(l.id);
      return reverted;
    });
    let nextGroups = current.groups ? [...current.groups] : undefined;

    for (const gr of patch.groups.values()) {
      const afterSet = new Set(gr.afterMemberIds);
      const removed = nextLayers.filter((l) => afterSet.has(l.id));
      deadComponentBufIds.push(...rasterBufferIds(removed));
      writtenBlobKeys.push(...gr.writtenBlobKeys);
      const restoredMembers = preserveLocalTextOverrides(removed, gr.afterMembers, gr.beforeMembers);
      for (const id of rasterBufferIds(restoredMembers)) restoredLayerIds.add(id);
      const firstIdx = nextLayers.findIndex((l) => afterSet.has(l.id));
      const kept = nextLayers.filter((l) => !afterSet.has(l.id));
      const at = firstIdx >= 0 ? Math.min(firstIdx, kept.length) : kept.length;
      kept.splice(at, 0, ...restoredMembers);
      nextLayers = kept;
      if (nextGroups) {
        const has = nextGroups.some((g) => g.id === gr.groupId);
        nextGroups = has ? nextGroups.map((g) => (g.id === gr.groupId ? gr.beforeGroup : g)) : [...nextGroups, gr.beforeGroup];
      } else {
        nextGroups = [gr.beforeGroup];
      }
    }

    const bgPatch = patch.backgroundBefore && current.background === patch.backgroundAfter?.background && sameVal(current.backgroundToken, patch.backgroundAfter?.backgroundToken)
      ? { background: patch.backgroundBefore.background, backgroundToken: patch.backgroundBefore.backgroundToken }
      : {};

    docsToApply.push({
      docId: current.id,
      next: { ...current, ...bgPatch, updatedAt: Date.now(), layers: nextLayers, ...(nextGroups ? { groups: nextGroups } : {}) },
    });
    for (const [bufId, canvas] of buffers) {
      if (restoredLayerIds.has(bufId)) buffersToRestore.set(bufId, canvas);
    }
  }

  const lib = useStore.getState().library;
  if (buffersToRestore.size) restoreBuffers(buffersToRestore);
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

export interface BrandSyncResult { docsUpdated: number; logosUpdated: number; componentsUpdated: number; tokensUpdated: number; summary: string }

let syncInFlight = false;
let syncQueued = false;

/** Propagates updated linked logos, component instances and (optionally) tokens from Library kits to designs in a session. */
export async function syncBrandInSession(
  sessionId: string,
  opts: { docId?: string; includeTokens?: boolean; recordNotice?: boolean; mergeLibrary?: readonly Subject[] } = {},
): Promise<BrandSyncResult> {
  const st0 = useStore.getState(), session0 = st0.sessions[sessionId];
  if (!session0) return { docsUpdated: 0, logosUpdated: 0, componentsUpdated: 0, tokensUpdated: 0, summary: '' };
  const targetDocIds = (opts.docId ? session0.docs.filter((d) => d.id === opts.docId) : session0.docs).map((d) => d.id);
  const patches = new Map<string, DocRevertPatch>();
  const revertBuffers = new Map<string, HTMLCanvasElement>();
  const replacedBufIds: string[] = [];
  const changedNames: string[] = [];
  let docsUpdated = 0, logosUpdated = 0, componentsUpdated = 0, tokensUpdated = 0;

  for (const docId of targetDocIds) {
    const stStart = useStore.getState();
    const docSnap = getDoc(sessionId, docId);
    if (!docSnap) continue;

    // Phase 1 (async): prepare logo canvases & component snapshots WITHOUT holding a stale doc snapshot for final write.
    const preparedLogos: Array<{ layerId: string; subjectId: string; nodeId: string; expectedAssetId: string; nextAssetId: string; title: string; slug: string; filename: string; canvas: HTMLCanvasElement }> = [];
    const logoCandidates: Array<{ layer: RasterLayer; assetId: string; title: string; slug: string; filename: string }> = [];
    for (const l of docSnap.layers) {
      if (l.type !== 'raster' || !l.libraryAsset) continue;
      const kit = stStart.library.find((s) => s.id === l.libraryAsset!.subjectId);
      const slot = slotOf(kit, l.libraryAsset.nodeId);
      if (kit && slot && slot.assetId !== l.libraryAsset.assetId) {
        const file = brandSlotFile(kit, l.libraryAsset.nodeId, stStart.assets, slot.title, slot.assetId);
        logoCandidates.push({ layer: l, assetId: slot.assetId, title: slot.title, slug: file.slug, filename: file.filename });
      }
    }
    if (logoCandidates.length) {
      await ensureBuffers(logoCandidates.map((u) => u.layer));
      for (const [id, c] of snapshotBuffers(logoCandidates.map((u) => u.layer.id))) {
        if (!revertBuffers.has(id)) revertBuffers.set(id, cloneCanvas(c));
      }
      for (const u of logoCandidates) {
        const canvas = await assetCanvas(u.assetId).catch(() => null);
        if (!canvas) continue;
        preparedLogos.push({
          layerId: u.layer.id, subjectId: u.layer.libraryAsset!.subjectId, nodeId: u.layer.libraryAsset!.nodeId,
          expectedAssetId: u.layer.libraryAsset!.assetId, nextAssetId: u.assetId, title: u.title, slug: u.slug, filename: u.filename, canvas,
        });
      }
    }

    type PreparedComp = {
      groupId: string; expectedVersionId: string; nextVersionId: string; bumpOnly: boolean;
      srcGroup?: LayerGroup; nextLayers?: Layer[]; idMap?: Map<string, string>; written: string[];
      prevSrcLayers?: Layer[];
    };
    const preparedComps: PreparedComp[] = [];
    const outdatedGroups = liveGroups(docSnap).filter((g) => {
      if (!g.from) return false;
      const kit = stStart.library.find((s) => s.id === g.from!.subjectId);
      return Boolean(kit?.versionId && kit.versionId !== g.from.versionId && (!kit.groupIds || kit.groupIds.includes(g.from.pieceId)));
    });
    for (const g of outdatedGroups) {
      const kit = stStart.library.find((s) => s.id === g.from!.subjectId);
      if (!kit?.versionId) continue;
      const snap = await readKitVersion(kit.versionId).catch(() => null);
      if (!snap?.doc) continue;
      const srcGroup = (snap.doc.groups ?? []).find((x) => x.id === g.from!.pieceId);
      const srcLayers = snap.doc.layers.filter((l) => l.groupId === g.from!.pieceId);
      if (!srcGroup || !srcLayers.length) continue;

      const prevSnap = g.from!.versionId ? await readKitVersion(g.from!.versionId).catch(() => null) : null;
      if (!componentChanged(prevSnap?.doc, snap.doc, g.from!.pieceId)) {
        preparedComps.push({ groupId: g.id, expectedVersionId: g.from!.versionId, nextVersionId: kit.versionId, bumpOnly: true, written: [] });
        continue;
      }

      const liveNow = getDoc(sessionId, docId);
      const curMembers = liveNow ? liveNow.layers.filter((l) => l.groupId === g.id) : [];
      const written: string[] = [];
      try {
        await ensureBuffers(curMembers);
        const curBufIds = rasterBufferIds(curMembers);
        for (const [id, c] of snapshotBuffers(curBufIds)) {
          if (!revertBuffers.has(id)) revertBuffers.set(id, cloneCanvas(c));
        }
        const copied = await copyDocPixels({ ...snap.doc, layers: srcLayers }, null, expectedRasterIds(snap), written);
        const idMap = new Map<string, string>();
        const nextLayers = srcLayers.map((l) => { const n = cloneComponentLayer(l, g.id, copied.map); idMap.set(l.id, n.id); return n; });
        const prevSrcLayers = prevSnap?.doc?.layers.filter((l) => l.groupId === g.from!.pieceId) ?? [];
        preparedComps.push({
          groupId: g.id, expectedVersionId: g.from!.versionId, nextVersionId: kit.versionId, bumpOnly: false,
          srcGroup, nextLayers, idMap, written, prevSrcLayers,
        });
      } catch {
        await cleanupKeys(written);
      }
    }

    // Phase 2 (synchronous atomic commit onto the LATEST live doc so concurrent user edits are never lost).
    let docTouched = false;
    const docPatch = emptyDocPatch(docId);
    const unusedWritten: string[] = [];
    setDoc(sessionId, docId, (liveDoc) => {
      const liveLib = useStore.getState().library;
      let doc = liveDoc, touched = false, bumped = false;

      if (opts.includeTokens) {
        const tokChanged = new Set<string>();
        const next = syncTokens(doc, liveLib, { changed: tokChanged });
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

      for (const u of preparedLogos) {
        const curLayer = doc.layers.find((x) => x.id === u.layerId);
        if (!curLayer || curLayer.type !== 'raster' || !curLayer.libraryAsset) continue;
        if (curLayer.libraryAsset.subjectId !== u.subjectId || curLayer.libraryAsset.nodeId !== u.nodeId || curLayer.libraryAsset.assetId !== u.expectedAssetId) continue;
        // R1: Revalidate against LIVE library so a stale prepared asset never overwrites a newer slot change.
        const liveSlot = slotOf(liveLib.find((s) => s.id === u.subjectId), u.nodeId);
        if (!liveSlot || liveSlot.assetId !== u.nextAssetId) continue;
        const nextWidth = curLayer.width > 0 ? curLayer.width : u.canvas.width;
        const nextHeight = u.canvas.width > 0 ? Math.max(1, Math.round((nextWidth * u.canvas.height) / u.canvas.width)) : curLayer.height;
        setBuffer(curLayer.id, u.canvas);
        doc = D.updateLayer(doc, curLayer.id, {
          width: nextWidth, height: nextHeight, pxWidth: u.canvas.width, pxHeight: u.canvas.height,
          rev: curLayer.rev + 1, sourceAssetId: u.nextAssetId,
          libraryAsset: { ...curLayer.libraryAsset, assetId: u.nextAssetId, slug: u.slug, filename: u.filename },
        } as Partial<RasterLayer>);
        const afterLayer = doc.layers.find((x) => x.id === curLayer.id);
        if (afterLayer) recordLayerPatch(docPatch, curLayer, afterLayer);
        touched = true; logosUpdated++; changedNames.push(`logo «${u.title}»`);
      }

      for (const c of preparedComps) {
        const curGroup = liveGroups(doc).find((x) => x.id === c.groupId);
        const liveKit = curGroup?.from ? liveLib.find((s) => s.id === curGroup.from!.subjectId) : undefined;
        if (!curGroup?.from || curGroup.from.versionId !== c.expectedVersionId || !liveKit || liveKit.versionId !== c.nextVersionId) {
          unusedWritten.push(...c.written);
          continue;
        }
        if (c.bumpOnly) {
          doc = { ...doc, groups: liveGroups(doc).map((x) => (x.id === curGroup.id ? { ...x, from: { ...x.from!, versionId: c.nextVersionId } } : x)) };
          bumped = true;
          continue;
        }
        const curMembers = doc.layers.filter((l) => l.groupId === curGroup.id);
        const curBox = D.unionBox(curMembers.map(D.approxLayerBox).filter((b): b is D.Box => b != null));
        let nextLayers = preserveLocalTextOverrides(curMembers, c.prevSrcLayers ?? [], c.nextLayers!);
        const srcBox = D.unionBox(nextLayers.map(D.approxLayerBox).filter((b): b is D.Box => b != null));
        if (curBox && srcBox) nextLayers = nextLayers.map((l) => D.translateLayer(l, curBox.x - srcBox.x, curBox.y - srcBox.y));
        nextLayers = syncTokens({ ...doc, layers: nextLayers }, liveLib).layers;
        const firstIdx = doc.layers.findIndex((l) => l.groupId === curGroup.id);
        const kept = doc.layers.filter((l) => l.groupId !== curGroup.id);
        const at = firstIdx >= 0 ? Math.min(firstIdx, kept.length) : kept.length;
        kept.splice(at, 0, ...nextLayers);
        const updatedGroup: LayerGroup = {
          ...curGroup, name: c.srcGroup!.name, from: { ...curGroup.from, versionId: c.nextVersionId },
          ...(c.srcGroup!.keptHidden ? { keptHidden: c.srcGroup!.keptHidden.map((id) => c.idMap!.get(id) ?? id) } : { keptHidden: undefined }),
          ...(c.srcGroup!.keptLocked ? { keptLocked: c.srcGroup!.keptLocked.map((id) => c.idMap!.get(id) ?? id) } : { keptLocked: undefined }),
        };
        doc = { ...doc, updatedAt: Date.now(), layers: kept, groups: liveGroups(doc).map((x) => (x.id === curGroup.id ? updatedGroup : x)) };
        docPatch.groups.set(curGroup.id, {
          groupId: curGroup.id,
          beforeGroup: curGroup,
          beforeMembers: curMembers,
          afterMembers: nextLayers,
          afterMemberIds: nextLayers.map((l) => l.id),
          writtenBlobKeys: [...c.written],
        });
        replacedBufIds.push(...rasterBufferIds(curMembers));
        touched = true; componentsUpdated++; changedNames.push(`componente «${c.srcGroup!.name}»`);
      }

      if (touched) docTouched = true;
      return touched || bumped ? doc : liveDoc;
    });

    if (unusedWritten.length) await cleanupKeys(unusedWritten);
    if (docTouched) {
      patches.set(docId, docPatch);
      docsUpdated++;
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
  const trigger = (mergeLibrary?: readonly Subject[]) => {
    const st = useStore.getState();
    if (st.settings.brandSyncMode === 'manual') return;
    const sessionId = st.activeSessionId;
    if (!sessionId) return;
    const pending = pendingBrandUpdates(sessionId, st);
    if (!pending.logos && !pending.components) return;
    if (syncInFlight) { syncQueued = true; return; }
    syncInFlight = true;
    syncQueued = false;
    void syncBrandInSession(sessionId, { includeTokens: false, recordNotice: true, mergeLibrary }).finally(() => {
      syncInFlight = false;
      if (syncQueued) {
        syncQueued = false;
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
