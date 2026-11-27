import { isSvg } from '../lib/imports';
import { useStore } from '../store/store';
import { uploadFiles } from './actions';
import { isFontFile } from './fontFiles';
import { addToSection } from './librarySections';
import { tokensFromFile } from './libraryTokensFile';
import { isKit } from './libraryTypes';
import { saveItem } from './libraryVersions';
import { addFonts } from './ownFonts';

/* One-drop Brand Kit importer: classifies mixed JSON tokens, font files and logo/image files automatically. */

const LOGO_NAME = /\b(logo|logotipo|isotipo|imagotipo|wordmark|brandmark|marca|emblema|icon|icono)\b/i;

export const BRAND_IMPORT_ACCEPT = '.json,application/json,.ttf,.otf,.woff,.woff2,image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg';

export interface BrandBulkImportResult {
  tokens: number;
  fonts: string[];
  logos: number;
  images: number;
  skipped: string[];
}

/** Imports a mixed batch of files (tokens.json, fonts, logos, photos) into a Brand Kit or Design System in one step. */
export async function importBrandFiles(subjectId: string, files: readonly File[]): Promise<BrandBulkImportResult> {
  const kit = useStore.getState().library.find((s) => s.id === subjectId && isKit(s) && s.kind !== 'moodboard');
  if (!kit) throw new Error(`No brand kit or design system "${subjectId}".`);
  const jsonFiles: File[] = [], fontFiles: File[] = [], logoFiles: File[] = [], imageFiles: File[] = [], skipped: string[] = [];

  for (const f of files) {
    if (/\.json$/i.test(f.name) || f.type === 'application/json') jsonFiles.push(f);
    else if (isFontFile(f)) fontFiles.push(f);
    else if (f.type.startsWith('image/') || isSvg(f)) (LOGO_NAME.test(f.name) ? logoFiles : imageFiles).push(f);
    else skipped.push(f.name);
  }

  let tokensAdded = 0;
  if (jsonFiles.length) {
    const merged = { ...(useStore.getState().library.find((s) => s.id === subjectId)?.tokens ?? {}) };
    for (const f of jsonFiles) {
      const parsed = tokensFromFile(await f.text());
      const entries = Object.entries(parsed.tokens);
      for (const [k, v] of entries) merged[k] = v;
      tokensAdded += entries.length;
    }
    if (tokensAdded > 0) await saveItem({ subjectId, mode: 'overwrite', space: 'library', by: 'user', tokens: merged });
  }

  const fonts = fontFiles.length ? await addFonts(subjectId, fontFiles) : [];

  let logos = 0, images = 0;
  if (logoFiles.length) {
    const ids = await uploadFiles(logoFiles);
    if (ids.length) { await addToSection(subjectId, kit.kind === 'design-system' ? 'Icons' : 'Logos', { assetIds: ids }); logos = ids.length; }
  }
  if (imageFiles.length) {
    const ids = await uploadFiles(imageFiles);
    if (ids.length) { await addToSection(subjectId, kit.kind === 'design-system' ? 'References' : 'Photos', { assetIds: ids }); images = ids.length; }
  }

  return { tokens: tokensAdded, fonts, logos, images, skipped };
}

export function formatBulkImportSummary(r: BrandBulkImportResult): string {
  const parts: string[] = [];
  if (r.tokens) parts.push(`${r.tokens} ${r.tokens === 1 ? 'token' : 'tokens'}`);
  if (r.fonts.length) parts.push(`${r.fonts.length} ${r.fonts.length === 1 ? 'fuente' : 'fuentes'}`);
  if (r.logos) parts.push(`${r.logos} ${r.logos === 1 ? 'logo' : 'logos'}`);
  if (r.images) parts.push(`${r.images} ${r.images === 1 ? 'imagen' : 'imágenes'}`);
  return parts.length ? parts.join(', ') : 'sin elementos reconocibles';
}
