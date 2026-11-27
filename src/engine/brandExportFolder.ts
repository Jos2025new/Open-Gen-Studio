import { getAssetBlob } from '../lib/idb';
import { blobToDataUrl } from '../lib/media';
import { useStore } from '../store/store';
import { tokensToFile } from './libraryTokensFile';
import { isKit } from './libraryTypes';
import type { GraphNode } from './types';

/* Leaf module for Inkscape vigente/ brand-folder export (no imports from design/ to keep engine acyclic). */

export function brandSlug(raw: string, fallback = 'asset'): string {
  const s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || fallback;
}

export interface BrandExportFolderResult { dir: string; vigentePath: string; versionDir: string; files: string[] }

/** Writes the kit's current version assets + tokens.json to disk and points `<kit>/vigente` symlink to it (for Inkscape SVGs). */
export async function syncBrandExportFolder(subjectId: string): Promise<BrandExportFolderResult> {
  const st = useStore.getState(), kit = st.library.find((s) => s.id === subjectId && isKit(s));
  if (!kit) throw new Error(`No brand kit "${subjectId}".`);
  const slots = (kit.graph?.nodes ?? []).filter((n): n is GraphNode & { data: { kind: 'asset'; assetId: string; title: string; section?: string } } => n.data.kind === 'asset' && Boolean(n.data.assetId));
  const assets: Array<{ filename: string; dataUrl: string; slotTitle: string; section?: string }> = [];
  const logoTokens: Record<string, { $type: 'string'; $value: string }> = {};
  const usedNames = new Set<string>();
  for (const n of slots) {
    const blob = await getAssetBlob(n.data.assetId);
    if (!blob) continue;
    let slug = brandSlug(n.data.title || n.id, n.id);
    if (usedNames.has(slug)) slug = `${slug}-${n.id.slice(-4)}`;
    usedNames.add(slug);
    const filename = `${slug}.png`;
    assets.push({ filename, dataUrl: await blobToDataUrl(blob), slotTitle: n.data.title, section: n.data.section });
    logoTokens[slug] = { $type: 'string', $value: `vigente/${filename}` };
  }
  const baseTokens = JSON.parse(tokensToFile(kit.tokens ?? {}, 'w3c').text) as Record<string, unknown>;
  const tokensPayload = { ...baseTokens, ...(Object.keys(logoTokens).length ? { marca: { ...(typeof baseTokens.marca === 'object' && baseTokens.marca ? baseTokens.marca as Record<string, unknown> : {}), logo: logoTokens } } : {}) };
  const res = await fetch('/x/brand-export/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kitSlug: brandSlug(kit.name, kit.id), versionId: kit.versionId || `v-${Date.now()}`, tokensJson: JSON.stringify(tokensPayload, null, 2), assets }),
  });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Brand folder export failed (${res.status}).`);
  return res.json() as Promise<BrandExportFolderResult>;
}
