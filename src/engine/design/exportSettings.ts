export const EXPORT_FORMATS = ['png', 'jpg', 'webp', 'svg', 'pdf'] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];

export const PDF_PAPERS = {
  a4: { label: 'A4', mm: [210, 297] },
  letter: { label: 'Letter', mm: [215.9, 279.4] },
  legal: { label: 'Legal', mm: [215.9, 355.6] },
  a3: { label: 'A3', mm: [297, 420] },
  a5: { label: 'A5', mm: [148, 210] },
} as const;
export type PdfPaper = keyof typeof PDF_PAPERS;
export interface PdfPage { paper: PdfPaper; orientation: 'portrait' | 'landscape' }
export const DEFAULT_PDF_PAGE: PdfPage = { paper: 'a4', orientation: 'portrait' };

export function pdfPage(value: ExportSettings['pdf']): PdfPage | undefined {
  return value === 'a4' ? DEFAULT_PDF_PAGE : value === 'screen' ? undefined : value;
}

export function paperLayout(page: PdfPage, width: number, height: number) {
  const [short, long] = PDF_PAPERS[page.paper].mm.map((mm) => mm * 96 / 25.4);
  const [pageWidth, pageHeight] = page.orientation === 'portrait' ? [short, long] : [long, short];
  const scale = Math.min(pageWidth / width, pageHeight / height);
  const fittedWidth = width * scale, fittedHeight = height * scale;
  return { pageWidth, pageHeight, scale, width: fittedWidth, height: fittedHeight,
    x: (pageWidth - fittedWidth) / 2, y: (pageHeight - fittedHeight) / 2 };
}

export type ExportArea = 'canvas' | 'content' | 'objects' | 'selection' | 'layer';

/** One file of a multi-file export: a scale, the text added to the name, and a format. */
export interface ExportRow { scale: number; suffix: string; format: ExportFormat }
export interface SvgOptions { decimals?: number; minify?: boolean; metadata?: boolean }
/** Print shop PDF: the paper is the trim size; bleed is added on every side, marks need a slug outside it. */
export interface PrintOptions { bleedMm: number; marks: boolean }
/** Crop marks start this far beyond the bleed edge and are this long; the page grows by both. */
export const MARK_OFFSET_MM = 2;
export const MARK_LENGTH_MM = 5;
export const MARK_SLUG_MM = MARK_OFFSET_MM + MARK_LENGTH_MM;

export const row = (scale: number, format: ExportFormat, suffix = ''): ExportRow => ({ scale, suffix, format });
/** The suffix a plain scale gets when the user did not write one (2 gives @2x). */
export const autoSuffix = (scale: number) => (scale > 1 ? `@${scale}x` : '');

export const PX_PER_MM = 96 / 25.4;
/**
 * The PDF page for artwork `width` × `height`, in 96-dpi px. Paper: the design fitted inside. Print shop: trim = paper,
 * the artwork scaled to cover trim + bleed, with room for crop marks outside the bleed.
 */
export function pageLayout(page: PdfPage, width: number, height: number, print?: PrintOptions) {
  const paper = paperLayout(page, width, height);
  if (!print) return { ...paper, trim: undefined as undefined | { x: number; y: number; w: number; h: number }, bleed: 0, marks: false };
  const bleed = print.bleedMm * PX_PER_MM, slug = print.marks ? MARK_SLUG_MM * PX_PER_MM : 0, edge = bleed + slug;
  const trimW = paper.pageWidth, trimH = paper.pageHeight;
  const scale = Math.max((trimW + 2 * bleed) / width, (trimH + 2 * bleed) / height);
  const w = width * scale, h = height * scale;
  return { pageWidth: trimW + 2 * edge, pageHeight: trimH + 2 * edge, scale, width: w, height: h,
    x: edge + (trimW - w) / 2, y: edge + (trimH - h) / 2, trim: { x: edge, y: edge, w: trimW, h: trimH }, bleed, marks: print.marks };
}
export interface ExportSettings {
  format: ExportFormat;
  area: ExportArea;
  size: number | 'width' | 'long-side';
  pixels?: number;
  quality?: number;
  maxKb?: number;
  background?: string | null;
  fitInstagram?: boolean;
  pdf?: 'screen' | 'a4' | PdfPage;
  print?: PrintOptions;
  /** Several files at once; absent means one file from `format` and `size`. */
  outputs?: ExportRow[];
  /** Text before the name. */
  prefix?: string;
  /** Settings that apply when SVG is among the outputs. */
  svg?: SvgOptions;
  /** SVG and PDF text: keep it live with embedded fonts, or draw the letters as paths. */
  text?: 'fonts' | 'paths';
  /** PDF on paper: resolution of what becomes an image at the printed size (default 300). */
  ppi?: number;
  /** Put the files in subfolders by format when saving to a chosen folder. */
  subfolders?: boolean;
  /** Inside one output of `outputs`: the text added to that file's name. */
  suffix?: string;
  preset?: string;
  /** The preset these settings started from (kept after edits, so the panel can say "edited"). */
  base?: string;
}

/** The file rows an export produces: its own list, or the single format and size. */
export function exportRows(settings: ExportSettings): ExportRow[] {
  return settings.outputs?.length ? settings.outputs : [row(typeof settings.size === 'number' ? settings.size : 1, settings.format)];
}

export interface RememberedExport {
  settings: ExportSettings;
  target?: string;
}

export interface CustomExportPreset {
  id: string;
  name: string;
  settings: ExportSettings;
}

export const DEFAULT_EXPORT: ExportSettings = { format: 'png', area: 'canvas', size: 1 };
const defaults = (preset: string, options: Partial<ExportSettings>): ExportSettings => ({ ...DEFAULT_EXPORT, ...options, preset });

export const BUILTIN_EXPORTS = [
  { id: 'whatsapp', name: 'WhatsApp', group: 'Share', settings: defaults('whatsapp', { format: 'jpg', size: 'long-side', pixels: 1600, quality: 85 }) },
  { id: 'instagram', name: 'Instagram', group: 'Share', settings: defaults('instagram', { format: 'jpg', size: 'width', pixels: 1080 }) },
  { id: 'web', name: 'Lightweight web', group: 'Share', settings: defaults('web', { format: 'webp', quality: 80 }) },
  { id: 'home-print', name: 'Print at home', group: 'Print', settings: defaults('home-print', { format: 'pdf', pdf: DEFAULT_PDF_PAGE }) },
  { id: 'portfolio', name: 'Portfolio', group: 'Work', settings: defaults('portfolio', { size: 2 }) },
  { id: 'brand', name: 'Logo / brand', group: 'Work', settings: defaults('brand', { format: 'svg', text: 'paths', outputs: [row(1, 'svg'), row(1, 'png'), row(2, 'png', '@2x')] }) },
  { id: 'ios', name: 'iOS', group: 'Apps', settings: defaults('ios', { outputs: [row(1, 'png'), row(2, 'png', '@2x'), row(3, 'png', '@3x')] }) },
  { id: 'android', name: 'Android', group: 'Apps', settings: defaults('android', { outputs: [
    row(0.75, 'png', '-ldpi'), row(1, 'png', '-mdpi'), row(1.5, 'png', '-hdpi'), row(2, 'png', '-xhdpi'), row(3, 'png', '-xxhdpi'), row(4, 'png', '-xxxhdpi')] }) },
  { id: 'print-shop', name: 'Print shop', group: 'Print', settings: defaults('print-shop', { format: 'pdf', pdf: DEFAULT_PDF_PAGE, print: { bleedMm: 3, marks: false }, text: 'paths' }) },
] as const;

export const DEFAULT_JPEG_QUALITY = 92;
