export const EXPORT_FORMATS = ['png', 'jpg', 'webp', 'svg', 'pdf'] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];

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
  pdf?: 'screen' | 'a4';
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
  { id: 'home-print', name: 'Print at home', group: 'Print', settings: defaults('home-print', { format: 'pdf', pdf: 'a4' }) },
  { id: 'portfolio', name: 'Portfolio', group: 'Work', settings: defaults('portfolio', { size: 2 }) },
  { id: 'brand', name: 'Logo / brand', group: 'Work', settings: defaults('brand', { format: 'svg' }) },
] as const;

export const DEFAULT_JPEG_QUALITY = 92;
