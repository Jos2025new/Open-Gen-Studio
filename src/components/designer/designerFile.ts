import type { ExportFormat } from '../../engine/design/export';
import { exportDocFile, saveDocToGallery } from '../../engine/design/actions';
import { importSvgFile } from '../../engine/design/svgImport/apply';
import { placeImportedImages } from '../../engine/design/importImages';
import { uploadFiles } from '../../engine/actions';
import { isSvg, prepareImportFile } from '../../lib/imports';
import { toast } from '../../store/store';

/** The file actions of the Designer (import and export), shared by its top bar and Studio's embedded Designer. */
export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; detail: string }> = [
  { id: 'png', label: 'PNG', detail: 'Image, keeps transparency' },
  { id: 'jpg', label: 'JPG', detail: 'Image, white background' },
  { id: 'svg', label: 'SVG', detail: 'Editable layers, text and shapes' },
  { id: 'pdf', label: 'PDF', detail: 'Vector; text in standard fonts' },
];

export const IMPORT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg,image/heic,image/heif,.heic,.heif,.eps,application/postscript';

export async function importDesignFiles(sessionId: string, docId: string, files: File[]): Promise<void> {
  // EPS (local Ghostscript) and HEIC (browser decoder) become PNG first; anything that cannot be read says why.
  const ready: File[] = [];
  for (const f of files) {
    // SVG becomes a design of its own: folders, editable shapes, and pictures for what cannot be edited.
    if (isSvg(f)) { await importSvgFile(sessionId, f); continue; }
    const r = await prepareImportFile(f);
    if (typeof r === 'string') toast(r, 'error'); else ready.push(r);
  }
  const ids = await uploadFiles(ready.filter((f) => f.type.startsWith('image/')));
  await placeImportedImages(sessionId, docId, ids);
}

/** Save to the gallery or download in a format; a failure becomes a toast. */
export async function runDesignOutput(sessionId: string, docId: string, gallery: boolean, format: ExportFormat = 'png'): Promise<void> {
  try { await (gallery ? saveDocToGallery(sessionId, docId) : exportDocFile(sessionId, docId, format)); }
  catch (err) { toast(err instanceof Error ? err.message : 'Export failed', 'error'); }
}
