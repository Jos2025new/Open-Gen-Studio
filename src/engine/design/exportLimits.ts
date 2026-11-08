import { ExportError } from './exportErrors';

/** FX delivery uses multiple canvases: cap each at 128 MiB; plain delivery keeps the editor dimensions. */
export const MAX_EXPORT_PIXELS = 33_554_432;
export const MAX_EXPORT_SIDE = 8192;

export function checkExportSize(width: number, height: number, hasFx: boolean): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE || (hasFx && width * height > MAX_EXPORT_PIXELS)) {
    throw new ExportError(`No file was created at ${width} × ${height}, so choose a positive whole size up to ${hasFx ? '33,554,432 pixels total and ' : ''}8,192 pixels per side.`);
  }
}
