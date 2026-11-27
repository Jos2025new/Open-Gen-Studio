import { setDoc, setSettings, useStore } from '../store/store';
import { brandSlug, syncBrandExportFolder, type BrandExportFolderResult } from './brandExportFolder';
import { assetCanvas, getDoc, placeAsset } from './design/actions';
import * as D from './design/doc';
import { liveGroups } from './design/groups';
import { rasterBufferIds, restoreBuffers, setBuffer, snapshotBuffers } from './design/raster';
import { onAutoTokenSync, syncTokens } from './design/tokenBind';
import { cloneComponentLayer } from './libraryInsert';
import { isKit, type LibraryAssetRef } from './libraryTypes';
import { cleanupKeys, copyDocPixels, expectedRasterIds, readKitVersion } from './libraryVersions';
import type { DesignDoc, GraphNode, LayerGroup, RasterLayer, Subject } from './types';

export { brandSlug, syncBrandExportFolder, type BrandExportFolderResult };

/* Linked brand assets (logos), component instance sync, and corner notice with revert. */

function slotOf(subject: Subject | undefined, nodeId: string): { node: GraphNode; assetId: string; title: string } | null {
  const node = subject?.graph?.nodes.find((n) => n.id === nodeId && n.data.kind === 'asset' && n.data.assetId);
  if (!node || node.data.kind !== 'asset' || !node.data.assetId) return null;
  return { node, assetId: node.data.assetId, title: node.data.title || 'Logo' };
}

/** Stable relative SVG href ("vigente/<slug>.png") for a raster layer linked to a Brand Kit slot. */
export function linkedSvgHref(layer: Pick<RasterLayer, 'libraryAsset' | 'name'>, library: readonly Subject[] = useStore.getState().library): string | null {
  const ref = layer.libraryAsset;
  if (!ref) return null;
  const kit = library.find((s) => s.id === ref.subjectId);
  const slot = slotOf(kit, ref.nodeId);
  const slug = ref.slug || brandSlug(slot?.title || layer.name || ref.nodeId);
  return `vigente/${slug}.png`;
}

/** Places a Brand Kit image slot into a Designer document as a linked raster layer that follows slot replacements. */
export async function placeLinkedAsset(sessionId: string, docId: string, subjectId: string, nodeId: string, target: 'base' | 'new' = 'new'): Promise<string | null> {
  const kit = useStore.getState().library.find((s) => s.id === subjectId && isKit(s));
  const slot = slotOf(kit, nodeId);
  if (!kit || !slot) throw new Error(`No image slot "${nodeId}" in Library item "${subjectId}".`);
  const layerId = await placeAsset(sessionId, docId, slot.assetId, target, slot.title);
  if (!layerId) return null;
  const ref: LibraryAssetRef = { subjectId, nodeId, assetId: slot.assetId, slug: brandSlug(slot.title, nodeId) };
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

interface RevertPayload { sessionId: string; docs: DesignDoc[]; buffers: Map<string, HTMLCanvasElement> }
let currentNotice: BrandSyncNoticeState | null = null;
let revertPayload: RevertPayload | null = null;
let noticeSeq = 0;
const listeners = new Set<() => void>();
const emitNotice = () => { for (const fn of listeners) fn(); };

export function subscribeBrandSyncNotice(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getBrandSyncNotice(): BrandSyncNoticeState | null { return currentNotice; }
export function dismissBrandSyncNotice(): void { currentNotice = null; revertPayload = null; emitNotice(); }

function postNotice(sessionId: string, summary: string, revert?: RevertPayload): void {
  currentNotice = { id: ++noticeSeq, sessionId, summary, at: Date.now(), canRevert: Boolean(revert) };
  revertPayload = revert ?? null;
  emitNotice();
}

/** Reverts the last automatic or manual brand propagation in one click. */
export function revertBrandSyncNotice(): boolean {
  if (!revertPayload) return false;
  const { sessionId, docs, buffers } = revertPayload;
  revertPayload = null;
  currentNotice = null;
  if (buffers.size) restoreBuffers(buffers);
  for (const prev of docs) {
    if (getDoc(sessionId, prev.id)) setDoc(sessionId, prev.id, () => prev);
  }
  emitNotice();
  return true;
}

export function setBrandSyncMode(mode: 'auto' | 'manual'): void {
  setSettings({ brandSyncMode: mode });
  if (mode === 'manual' && currentNotice) dismissBrandSyncNotice();
}

export interface BrandSyncResult { docsUpdated: number; logosUpdated: number; componentsUpdated: number; tokensUpdated: number; summary: string }

/** Propagates updated linked logos, component instances and (optionally) tokens from Library kits to designs in a session. */
export async function syncBrandInSession(sessionId: string, opts: { docId?: string; includeTokens?: boolean; recordNotice?: boolean } = {}): Promise<BrandSyncResult> {
  const st = useStore.getState(), session = st.sessions[sessionId];
  if (!session) return { docsUpdated: 0, logosUpdated: 0, componentsUpdated: 0, tokensUpdated: 0, summary: '' };
  const targetDocs = opts.docId ? session.docs.filter((d) => d.id === opts.docId) : session.docs;
  const prevDocs: DesignDoc[] = [], snapBufIds = new Set<string>();
  const changedNames: string[] = [];
  let docsUpdated = 0, logosUpdated = 0, componentsUpdated = 0, tokensUpdated = 0;

  for (const doc0 of targetDocs) {
    let doc = doc0, touched = false;
    const beforeIds = rasterBufferIds(doc0.layers);

    if (opts.includeTokens) {
      const tokChanged = new Set<string>();
      const next = syncTokens(doc, st.library, { changed: tokChanged });
      if (next !== doc) {
        doc = next; touched = true; tokensUpdated += tokChanged.size;
        for (const t of tokChanged) changedNames.push(`token ${t}`);
      }
    }

    // 1. Linked raster logos / images
    const logoUpdates: Array<{ layer: RasterLayer; assetId: string; title: string; slug: string }> = [];
    for (const l of doc.layers) {
      if (l.type !== 'raster' || !l.libraryAsset) continue;
      const kit = st.library.find((s) => s.id === l.libraryAsset!.subjectId);
      const slot = slotOf(kit, l.libraryAsset.nodeId);
      if (kit && slot && slot.assetId !== l.libraryAsset.assetId) {
        logoUpdates.push({ layer: l, assetId: slot.assetId, title: slot.title, slug: l.libraryAsset.slug || brandSlug(slot.title, l.libraryAsset.nodeId) });
      }
    }
    if (logoUpdates.length) {
      for (const id of beforeIds) snapBufIds.add(id);
      for (const u of logoUpdates) {
        const canvas = await assetCanvas(u.assetId).catch(() => null);
        if (!canvas) continue;
        const nextWidth = u.layer.width > 0 ? u.layer.width : canvas.width;
        const nextHeight = canvas.width > 0 ? Math.max(1, Math.round((nextWidth * canvas.height) / canvas.width)) : u.layer.height;
        setBuffer(u.layer.id, canvas);
        doc = D.updateLayer(doc, u.layer.id, {
          width: nextWidth, height: nextHeight, pxWidth: canvas.width, pxHeight: canvas.height,
          rev: u.layer.rev + 1, sourceAssetId: u.assetId,
          libraryAsset: { ...u.layer.libraryAsset!, assetId: u.assetId, slug: u.slug },
        } as Partial<RasterLayer>);
        touched = true; logosUpdated++; changedNames.push(`logo «${u.title}»`);
      }
    }

    // 2. Component group instances
    const outdatedGroups = liveGroups(doc).filter((g) => {
      if (!g.from) return false;
      const kit = st.library.find((s) => s.id === g.from!.subjectId);
      return Boolean(kit?.versionId && kit.versionId !== g.from.versionId);
    });
    for (const g of outdatedGroups) {
      const kit = st.library.find((s) => s.id === g.from!.subjectId);
      if (!kit?.versionId) continue;
      const snap = await readKitVersion(kit.versionId).catch(() => null);
      if (!snap?.doc) continue;
      const srcGroup = (snap.doc.groups ?? []).find((x) => x.id === g.from!.pieceId);
      const srcLayers = snap.doc.layers.filter((l) => l.groupId === g.from!.pieceId);
      if (!srcGroup || !srcLayers.length) continue;
      const curMembers = doc.layers.filter((l) => l.groupId === g.id);
      const curBox = D.unionBox(curMembers.map(D.approxLayerBox).filter((b): b is D.Box => b != null));
      const written: string[] = [];
      try {
        for (const id of beforeIds) snapBufIds.add(id);
        const copied = await copyDocPixels({ ...snap.doc, layers: srcLayers }, null, expectedRasterIds(snap), written);
        const idMap = new Map<string, string>();
        let nextLayers = srcLayers.map((l) => { const n = cloneComponentLayer(l, g.id, copied.map); idMap.set(l.id, n.id); return n; });
        const srcBox = D.unionBox(nextLayers.map(D.approxLayerBox).filter((b): b is D.Box => b != null));
        if (curBox && srcBox) nextLayers = nextLayers.map((l) => D.translateLayer(l, curBox.x - srcBox.x, curBox.y - srcBox.y));
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
        touched = true; componentsUpdated++; changedNames.push(`componente «${srcGroup.name}»`);
      } catch {
        await cleanupKeys(written);
      }
    }

    if (touched) {
      prevDocs.push(doc0);
      setDoc(sessionId, doc0.id, () => doc);
      docsUpdated++;
    }
  }

  const unique = [...new Set(changedNames)];
  const summary = docsUpdated ? `Diseño actualizado (${unique.slice(0, 3).join(', ')}${unique.length > 3 ? ` +${unique.length - 3}` : ''})` : '';
  if (docsUpdated && opts.recordNotice !== false) {
    postNotice(sessionId, summary, { sessionId, docs: prevDocs, buffers: snapshotBuffers([...snapBufIds]) });
  }
  return { docsUpdated, logosUpdated, componentsUpdated, tokensUpdated, summary };
}

/** Installs automatic brand propagation (linked logos, components and token-sync corner notices). */
export function installBrandSync(): () => void {
  let running = false;
  onAutoTokenSync(({ sessionId, tokens, prevDocs }) => {
    const label = tokens.slice(0, 3).join(', ') + (tokens.length > 3 ? ` +${tokens.length - 3}` : '');
    postNotice(sessionId, `Diseño actualizado con ${tokens.length === 1 ? `el token «${label}»` : `los tokens ${label}`}`, { sessionId, docs: prevDocs, buffers: new Map() });
  });
  const unsub = useStore.subscribe((st, prev) => {
    if (st.library === prev.library || st.settings.brandSyncMode === 'manual' || running) return;
    const sessionId = st.activeSessionId;
    if (!sessionId) return;
    const pending = pendingBrandUpdates(sessionId, st);
    if (!pending.logos && !pending.components) return;
    running = true;
    void syncBrandInSession(sessionId, { includeTokens: false, recordNotice: true }).finally(() => { running = false; });
  });
  return () => { unsub(); onAutoTokenSync(null); };
}
