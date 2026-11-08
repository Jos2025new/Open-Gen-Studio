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

export type ExportArea = 'canvas' | 'selection' | 'layer';
export interface ExportSettings {
  format: ExportFormat;
  area: ExportArea;
  size: 1 | 2 | 3 | 'width' | 'long-side';
  pixels?: number;
  quality?: number;
  maxKb?: number;
  background?: string | null;
  fitInstagram?: boolean;
  pdf?: 'screen' | 'a4' | PdfPage;
  preset?: string;
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
  { id: 'brand', name: 'Logo / brand', group: 'Work', settings: defaults('brand', { format: 'svg' }) },
] as const;

export const DEFAULT_JPEG_QUALITY = 92;
