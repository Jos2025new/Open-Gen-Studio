import { getAssetBlob } from '../lib/idb';
import { blobToDataUrl } from '../lib/media';
import { useStore } from '../store/store';
import { tokensToFile } from './libraryTokensFile';
import { isKit } from './libraryTypes';
import type { Asset, GraphNode, RasterLayer, Subject } from './types';

/* Leaf module for Inkscape vigente/ brand-folder export (no imports from design/ to keep engine acyclic). */

export function brandSlug(raw: string, fallback = 'asset', maxLen = 64): string {
  const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = norm(raw) || norm(fallback) || 'asset';
  return base.slice(0, maxLen).replace(/-+$/g, '') || 'asset';
}

function brandAssetExt(mime?: string, name?: string): 'png' | 'jpg' | 'webp' | 'svg' {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim();
  if (m === 'image/svg+xml') return 'svg';
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/png') return 'png';
  const ext = (name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'svg') return 'svg';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  if (ext === 'webp') return 'webp';
  return 'png';
}

export interface BrandSlotFile { slug: string; filename: string; ext: 'png' | 'jpg' | 'webp' | 'svg' }

/** Deterministic disambiguated slug and filename (≤80 chars) per image slot in a Brand Kit. */
function brandSlotFiles(
  kit: Pick<Subject, 'graph'> | undefined,
  assets: Record<string, Pick<Asset, 'mime' | 'name'>> = useStore.getState().assets,
): Map<string, BrandSlotFile> {
  const out = new Map<string, BrandSlotFile>();
  const slots = (kit?.graph?.nodes ?? []).filter(
    (n): n is GraphNode & { data: { kind: 'asset'; assetId: string; title: string; section?: string } } =>
      n.data.kind === 'asset' && Boolean(n.data.assetId),
  );
  const used = new Set<string>();
  for (let i = 0; i < slots.length; i++) {
    const n = slots[i];
    const asset = assets[n.data.assetId];
    const ext = brandAssetExt(asset?.mime, asset?.name);
    const maxSlug = Math.min(64, 80 - 1 - ext.length);
    let slug = brandSlug(n.data.title || n.id, n.id, maxSlug);
    if (used.has(slug)) {
      const idTail = brandSlug(n.id, `${i + 1}`, 12).slice(-4) || `${i + 1}`;
      let candidate = `${slug.slice(0, Math.max(1, maxSlug - idTail.length - 1)).replace(/-+$/g, '') || 'asset'}-${idTail}`;
      let seq = 2;
      while (used.has(candidate)) {
        const suffix = `-${idTail}-${seq++}`;
        candidate = `${slug.slice(0, Math.max(1, maxSlug - suffix.length)).replace(/-+$/g, '') || 'asset'}${suffix}`;
      }
      slug = candidate;
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
  const maxSlug = Math.min(64, 80 - 1 - ext.length);
  const slug = brandSlug(fallbackTitle || nodeId, nodeId, maxSlug);
  return { slug, filename: `${slug}.${ext}`, ext };
}

/** Stable relative SVG href ("vigente/<filename>") for a raster layer linked to a Brand Kit slot. */
export function linkedBrandHref(
  layer: Pick<RasterLayer, 'libraryAsset' | 'name'>,
  library: readonly Subject[] = useStore.getState().library,
  assets: Record<string, Pick<Asset, 'mime' | 'name'>> = useStore.getState().assets,
): string | null {
  const ref = layer.libraryAsset;
  if (!ref) return null;
  const kit = library.find((s) => s.id === ref.subjectId);
  const fromKit = brandSlotFiles(kit, assets).get(ref.nodeId);
  if (fromKit) return `vigente/${fromKit.filename}`;
  if (ref.filename) return `vigente/${ref.filename}`;
  const asset = assets[ref.assetId];
  const ext = brandAssetExt(asset?.mime, asset?.name);
  const maxSlug = Math.min(64, 80 - 1 - ext.length);
  const slug = brandSlug(ref.slug || layer.name || ref.nodeId, ref.nodeId, maxSlug);
  return `vigente/${slug}.${ext}`;
}

export interface BrandExportFolderResult { dir: string; vigentePath: string; versionDir: string; files: string[] }

/** Writes the kit's current version assets + tokens.json to disk and points `<kit>/vigente` symlink to it (for Inkscape SVGs). */
export async function syncBrandExportFolder(subjectId: string): Promise<BrandExportFolderResult> {
  const st = useStore.getState(), kit = st.library.find((s) => s.id === subjectId && isKit(s));
  if (!kit) throw new Error(`No brand kit "${subjectId}".`);
  const slots = (kit.graph?.nodes ?? []).filter((n): n is GraphNode & { data: { kind: 'asset'; assetId: string; title: string; section?: string } } => n.data.kind === 'asset' && Boolean(n.data.assetId));
  const slotMap = brandSlotFiles(kit, st.assets);
  const assets: Array<{ filename: string; dataUrl: string; slotTitle: string; section?: string }> = [];
  const logoTokens: Record<string, { $type: 'string'; $value: string }> = {};
  for (const n of slots) {
    const blob = await getAssetBlob(n.data.assetId);
    if (!blob) continue;
    const file = slotMap.get(n.id) ?? brandSlotFile(kit, n.id, st.assets, n.data.title, n.data.assetId);
    assets.push({ filename: file.filename, dataUrl: await blobToDataUrl(blob), slotTitle: n.data.title, section: n.data.section });
    logoTokens[file.slug] = { $type: 'string', $value: `vigente/${file.filename}` };
  }
  const baseTokens = JSON.parse(tokensToFile(kit.tokens ?? {}, 'w3c').text) as Record<string, unknown>;
  const existingMarca = typeof baseTokens.marca === 'object' && baseTokens.marca && !Array.isArray(baseTokens.marca) ? baseTokens.marca as Record<string, unknown> : {};
  const existingLogo = typeof existingMarca.logo === 'object' && existingMarca.logo && !Array.isArray(existingMarca.logo) ? existingMarca.logo as Record<string, unknown> : {};
  const tokensPayload = {
    ...baseTokens,
    ...(Object.keys(logoTokens).length ? { marca: { ...existingMarca, logo: { ...existingLogo, ...logoTokens } } } : {}),
  };
  const res = await fetch('/x/brand-export/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OGS': '1' },
    body: JSON.stringify({ kitSlug: brandSlug(kit.name, kit.id, 64), versionId: brandSlug(kit.versionId || `v-${Date.now()}`, 'v1', 64), tokensJson: JSON.stringify(tokensPayload, null, 2), assets }),
  });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Brand folder export failed (${res.status}).`);
  return res.json() as Promise<BrandExportFolderResult>;
}
