import { isSvg } from '../lib/imports';
import { useStore } from '../store/store';
import { uploadFiles } from './actions';
import { brandSlug } from './brandExportFolder';
import { isFontFile } from './fontFiles';
import { addToSection, replaceSectionAsset, sectionNodes } from './librarySections';
import { tokensFromFile } from './libraryTokensFile';
import { isKit } from './libraryTypes';
import { saveItem } from './libraryVersions';
import { addFonts } from './ownFonts';

/* One-drop Brand Kit importer: classifies mixed JSON tokens, font files and logo/image files automatically. */

const LOGO_NAME = /(^|[\s._-])(logo|logotipo|isotipo|imagotipo|wordmark|brandmark|marca|emblema|icon|icono)([\s._-]|$)/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;

export const BRAND_IMPORT_ACCEPT = '.json,application/json,.ttf,.otf,.woff,.woff2,image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg';

export interface BrandBulkImportResult {
  tokens: number;
  fonts: string[];
  logos: number;
  images: number;
  skipped: string[];
  skippedTokens: string[];
}

function deepMergeJson(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    const prev = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && prev && typeof prev === 'object' && !Array.isArray(prev) && !('$value' in v) && !('$value' in prev)) {
      out[k] = deepMergeJson(prev as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function addOrReplaceInSection(subjectId: string, sectionTitle: string, files: File[]): Promise<number> {
  if (!files.length) return 0;
  const ids = await uploadFiles(files);
  if (!ids.length) return 0;
  const kit = useStore.getState().library.find((s) => s.id === subjectId);
  const existing = kit ? sectionNodes(kit, { title: sectionTitle }) : [];
  const bySlug = new Map<string, string>();
  for (const n of existing) {
    if (n.data.kind !== 'asset') continue;
    const slug = brandSlug((n.data.title || '').replace(/\.[a-z0-9]+$/i, ''), '');
    if (slug && !bySlug.has(slug)) bySlug.set(slug, n.id);
  }
  const toAdd: string[] = [];
  const assets = useStore.getState().assets;
  let count = 0;
  for (const assetId of ids) {
    const rawName = assets[assetId]?.name || '';
    const slug = brandSlug(rawName.replace(/\.[a-z0-9]+$/i, ''), '');
    const matchNode = slug ? bySlug.get(slug) : undefined;
    if (matchNode) {
      await replaceSectionAsset(subjectId, matchNode, assetId, 'user');
      count++;
    } else {
      toAdd.push(assetId);
      if (slug) bySlug.set(slug, assetId);
    }
  }
  if (toAdd.length) {
    await addToSection(subjectId, sectionTitle, { assetIds: toAdd });
    count += toAdd.length;
  }
  return count;
}

/** Imports a mixed batch of files (tokens.json, fonts, logos, photos) into a Brand Kit or Design System in one step. */
export async function importBrandFiles(subjectId: string, files: readonly File[]): Promise<BrandBulkImportResult> {
  const kit = useStore.getState().library.find((s) => s.id === subjectId && isKit(s) && s.kind !== 'moodboard');
  if (!kit) throw new Error(`No brand kit or design system "${subjectId}".`);
  const jsonFiles: File[] = [], fontFiles: File[] = [], logoFiles: File[] = [], imageFiles: File[] = [], skipped: string[] = [];

  for (const f of files) {
    if (/\.json$/i.test(f.name) || f.type === 'application/json') jsonFiles.push(f);
    else if (isFontFile(f)) fontFiles.push(f);
    else if (f.type.startsWith('image/') || isSvg(f) || IMAGE_EXT.test(f.name)) (LOGO_NAME.test(f.name) ? logoFiles : imageFiles).push(f);
    else skipped.push(f.name);
  }

  let tokensAdded = 0;
  const skippedTokens: string[] = [];
  if (jsonFiles.length) {
    let combinedRaw: Record<string, unknown> | null = null;
    for (const f of jsonFiles) {
      try {
        const parsedObj = JSON.parse(await f.text()) as unknown;
        if (!parsedObj || typeof parsedObj !== 'object' || Array.isArray(parsedObj)) {
          skipped.push(f.name);
          continue;
        }
        combinedRaw = combinedRaw ? deepMergeJson(combinedRaw, parsedObj as Record<string, unknown>) : (parsedObj as Record<string, unknown>);
      } catch {
        skipped.push(f.name);
      }
    }
    if (combinedRaw) {
      const parsed = tokensFromFile(JSON.stringify(combinedRaw));
      skippedTokens.push(...parsed.skipped);
      const entries = Object.entries(parsed.tokens);
      if (entries.length) {
        const merged = { ...(useStore.getState().library.find((s) => s.id === subjectId)?.tokens ?? {}) };
        for (const [k, v] of entries) merged[k] = v;
        tokensAdded = entries.length;
        await saveItem({ subjectId, mode: 'overwrite', space: 'library', by: 'user', tokens: merged });
      }
    }
  }

  const fonts = fontFiles.length ? await addFonts(subjectId, fontFiles) : [];
  const logos = await addOrReplaceInSection(subjectId, kit.kind === 'design-system' ? 'Icons' : 'Logos', logoFiles);
  const images = await addOrReplaceInSection(subjectId, kit.kind === 'design-system' ? 'References' : 'Photos', imageFiles);

  return { tokens: tokensAdded, fonts, logos, images, skipped, skippedTokens };
}

export function formatBulkImportSummary(r: BrandBulkImportResult): string {
  const parts: string[] = [];
  if (r.tokens) parts.push(`${r.tokens} ${r.tokens === 1 ? 'token' : 'tokens'}`);
  if (r.fonts.length) parts.push(`${r.fonts.length} ${r.fonts.length === 1 ? 'fuente' : 'fuentes'}`);
  if (r.logos) parts.push(`${r.logos} ${r.logos === 1 ? 'logo' : 'logos'}`);
  if (r.images) parts.push(`${r.images} ${r.images === 1 ? 'imagen' : 'imágenes'}`);
  if (r.skipped.length) parts.push(`${r.skipped.length} omitido${r.skipped.length === 1 ? '' : 's'}`);
  if (r.skippedTokens.length) parts.push(`${r.skippedTokens.length} token${r.skippedTokens.length === 1 ? '' : 's'} no soportado${r.skippedTokens.length === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'sin elementos reconocibles';
}
