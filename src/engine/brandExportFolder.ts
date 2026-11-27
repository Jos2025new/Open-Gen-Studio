import { getAssetBlob } from '../lib/idb';
import { blobToCanvas, blobToDataUrl, canvasToBlob } from '../lib/media';
import { useStore } from '../store/store';
import { tokensToFile } from './libraryTokensFile';
import { isKit } from './libraryTypes';
import type { Asset, GraphNode, RasterLayer, Subject } from './types';

/* Leaf module for Inkscape vigente/ brand-folder export (no imports from design/ to keep engine acyclic). */

const MAX_KIT_SLUG = 64;
const MAX_FILENAME = 80;

export function brandSlug(raw: string, fallback = 'asset', maxLen = MAX_KIT_SLUG): string {
  const s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = (s || fallback).slice(0, maxLen).replace(/-+$/g, '');
  return base || fallback.slice(0, maxLen) || 'asset';
}

/** Stable extension based strictly on the exported blob's MIME: true SVG stays .svg, all raster (including rasterized SVG uploads) normalize to .png. */
export function brandAssetExt(mime?: string, _name?: string): string {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  if (m === 'image/svg+xml') return 'svg';
  return 'png';
}

/** Stable unique directory slug for a kit tied to its immutable id so adding homonymous kits never moves existing exports. */
export function kitExportSlug(kit: Pick<Subject, 'id' | 'name'>): string {
  const suffix = `-${kit.id.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase() || 'kit'}`;
  const base = brandSlug(kit.name, 'kit', Math.max(1, MAX_KIT_SLUG - suffix.length));
  return `${base}${suffix}`;
}

export interface BrandSlotFile { slug: string; filename: string; ext: string }

/** Deterministic slot -> { slug, filename } map for a Brand Kit, shared by placeLinkedAsset, SVG export and disk sync. */
function brandSlotFiles(kit: Pick<Subject, 'graph'> | undefined, assets: Record<string, Pick<Asset, 'mime' | 'name'>>): Map<string, BrandSlotFile> {
  const out = new Map<string, BrandSlotFile>();
  if (!kit?.graph?.nodes?.length) return out;
  const used = new Set<string>();
  for (const n of kit.graph.nodes) {
    if (n.data.kind !== 'asset' || !n.data.assetId) continue;
    const asset = assets[n.data.assetId];
    const ext = brandAssetExt(asset?.mime, asset?.name);
    const maxSlug = Math.min(MAX_KIT_SLUG, MAX_FILENAME - 1 - ext.length);
    const rawTitle = (n.data.title || '').replace(/\.[a-z0-9]+$/i, '');
    let slug = brandSlug(rawTitle || n.id, n.id, maxSlug);
    if (used.has(slug)) {
      const suffix = `-${n.id.replace(/[^a-z0-9]/gi, '').slice(-4).toLowerCase() || 'dup'}`;
      slug = `${slug.slice(0, Math.max(1, maxSlug - suffix.length)).replace(/-+$/g, '')}${suffix}`;
      let i = 2;
      while (used.has(slug)) {
        const alt = `-${i++}`;
        slug = `${slug.slice(0, Math.max(1, maxSlug - alt.length)).replace(/-+$/g, '')}${alt}`;
      }
    }
    used.add(slug);
    out.set(n.id, { slug, filename: `${slug}.${ext}`, ext });
  }
  return out;
}

/** Deterministic slot slug and filename for one nodeId in a Brand Kit (shared by placeLinkedAsset, export & disk sync). */
export function brandSlotFile(
  kit: Pick<Subject, 'graph'> | undefined,
  nodeId: string,
  assets: Record<string, Pick<Asset, 'mime' | 'name'>> = useStore.getState().assets,
  fallbackTitle?: string,
  fallbackAssetId?: string,
): BrandSlotFile {
  const found = brandSlotFiles(kit, assets).get(nodeId);
  if (found) return found;
  const asset = fallbackAssetId ? assets[fallbackAssetId] : undefined;
  const ext = brandAssetExt(asset?.mime, asset?.name);
  const maxSlug = Math.min(MAX_KIT_SLUG, MAX_FILENAME - 1 - ext.length);
  const slug = brandSlug((fallbackTitle || nodeId).replace(/\.[a-z0-9]+$/i, ''), nodeId, maxSlug);
  return { slug, filename: `${slug}.${ext}`, ext };
}

/** Stable relative SVG href ("vigente/<filename>" or "<kitDir>/vigente/<filename>" for multi-kit SVGs). */
export function linkedBrandHref(
  layer: Pick<RasterLayer, 'libraryAsset' | 'name'>,
  library: readonly Subject[] = useStore.getState().library,
  assets: Record<string, Pick<Asset, 'mime' | 'name'>> = useStore.getState().assets,
  multiKit = false,
): string | null {
  const ref = layer.libraryAsset;
  if (!ref) return null;
  const kit = library.find((s) => s.id === ref.subjectId);
  const prefix = multiKit && kit ? `${kitExportSlug(kit)}/vigente/` : 'vigente/';
  if (kit) {
    const found = brandSlotFiles(kit, assets).get(ref.nodeId);
    if (found) return `${prefix}${found.filename}`;
  }
  if (ref.filename) return `${prefix}${ref.filename}`;
  const fallbackExt = brandAssetExt(assets[ref.assetId]?.mime, assets[ref.assetId]?.name);
  const maxSlug = Math.min(MAX_KIT_SLUG, MAX_FILENAME - 1 - fallbackExt.length);
  const slug = brandSlug(ref.slug || layer.name || ref.nodeId, ref.nodeId, maxSlug);
  return `${prefix}${slug}.${fallbackExt}`;
}

async function normalizeExportBlob(blob: Blob, ext: string): Promise<Blob> {
  if (ext === 'svg' || blob.type === 'image/png') return blob;
  try {
    const canvas = await blobToCanvas(blob);
    return await canvasToBlob(canvas, 'image/png');
  } catch {
    return blob;
  }
}

export interface BrandExportFolderResult { dir: string; vigentePath: string; versionDir: string; files: string[]; kitSlug: string; syncedSlots: Record<string, string> }

/** Writes the kit's current version assets + tokens.json to disk and points `<kit>/vigente` symlink to it (for Inkscape SVGs). */
export async function syncBrandExportFolder(subjectId: string): Promise<BrandExportFolderResult> {
  const st = useStore.getState(), kit = st.library.find((s) => s.id === subjectId && isKit(s));
  if (!kit) throw new Error(`No brand kit "${subjectId}".`);
  const slots = (kit.graph?.nodes ?? []).filter((n): n is GraphNode & { data: { kind: 'asset'; assetId: string; title: string; section?: string } } => n.data.kind === 'asset' && Boolean(n.data.assetId));
  const slotMap = brandSlotFiles(kit, st.assets);
  const assets: Array<{ filename: string; dataUrl: string; slotTitle: string; section?: string }> = [];
  const logoTokens: Record<string, { $type: 'string'; $value: string }> = {};
  const syncedSlots: Record<string, string> = {};
  for (const n of slots) {
    const rawBlob = await getAssetBlob(n.data.assetId);
    if (!rawBlob) continue;
    const { slug, filename, ext } = slotMap.get(n.id) ?? brandSlotFile(kit, n.id, st.assets, n.data.title, n.data.assetId);
    const outBlob = await normalizeExportBlob(rawBlob, ext);
    assets.push({ filename, dataUrl: await blobToDataUrl(outBlob), slotTitle: n.data.title, section: n.data.section });
    logoTokens[slug] = { $type: 'string', $value: `vigente/${filename}` };
    syncedSlots[n.id] = filename;
  }
  const baseTokens = JSON.parse(tokensToFile(kit.tokens ?? {}, 'w3c').text) as Record<string, unknown>;
  const existingMarca = typeof baseTokens.marca === 'object' && baseTokens.marca && !Array.isArray(baseTokens.marca) ? { ...(baseTokens.marca as Record<string, unknown>) } : {};
  const existingLogo = typeof existingMarca.logo === 'object' && existingMarca.logo && !Array.isArray(existingMarca.logo) ? { ...(existingMarca.logo as Record<string, unknown>) } : {};
  // Never overwrite ANY pre-existing user token key (leaf or subtree) under marca.logo.
  for (const [slug, tok] of Object.entries(logoTokens)) {
    const key = Object.prototype.hasOwnProperty.call(existingLogo, slug) ? `${slug}_vigente` : slug;
    existingLogo[key] = tok;
  }
  // Preserve non-default token modes under $extensions.ogs.modes so Dark/theme values are never lost in tokens.json.
  const modeMap: Record<string, Record<string, string | number>> = {};
  for (const [name, t] of Object.entries(kit.tokens ?? {})) {
    for (const [mode, val] of Object.entries(t.modes ?? {})) (modeMap[mode] ??= {})[name] = val;
  }
  const tokensPayload: Record<string, unknown> = {
    ...baseTokens,
    ...(Object.keys(logoTokens).length ? { marca: { ...existingMarca, logo: existingLogo } } : {}),
    ...(Object.keys(modeMap).length ? { $extensions: { ...(typeof baseTokens.$extensions === 'object' && baseTokens.$extensions ? baseTokens.$extensions as Record<string, unknown> : {}), 'ogs.modes': modeMap } } : {}),
  };
  const kSlug = kitExportSlug(kit);
  const res = await fetch('/x/brand-export/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OGS': '1' },
    body: JSON.stringify({
      kitSlug: kSlug,
      versionId: brandSlug(kit.versionId || `v-${Date.now()}`, 'v1', 64),
      tokensJson: JSON.stringify(tokensPayload, null, 2),
      assets,
    }),
  });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Brand folder export failed (${res.status}).`);
  const disk = await res.json() as { dir: string; vigentePath: string; versionDir: string; files: string[] };
  return { ...disk, kitSlug: kSlug, syncedSlots };
}
