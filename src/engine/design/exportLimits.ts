/** Application guard for raster delivery: 8K UHD fits, one RGBA canvas stays at or below 128 MiB. */
export const MAX_EXPORT_PIXELS = 33_554_432;
export const MAX_EXPORT_SIDE = 8192;

export function checkExportSize(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE || width * height > MAX_EXPORT_PIXELS) {
    throw new Error(`Export cancelled: ${width} × ${height} exceeds the supported raster size. Use positive whole dimensions, at most 33,554,432 pixels and 8,192 pixels per side. No file was created; reduce the document size explicitly.`);
  }
}
