/** FX delivery uses multiple canvases: cap each at 128 MiB; plain delivery keeps the editor dimensions. */
export const MAX_EXPORT_PIXELS = 33_554_432;
export const MAX_EXPORT_SIDE = 8192;

export function checkExportSize(width: number, height: number, hasFx: boolean): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE || (hasFx && width * height > MAX_EXPORT_PIXELS)) {
    throw new Error(`Export cancelled: ${width} × ${height} exceeds the supported raster size. Use positive whole dimensions, ${hasFx ? 'at most 33,554,432 pixels and ' : ''}8,192 pixels per side. No file was created; reduce the document size explicitly.`);
  }
}
