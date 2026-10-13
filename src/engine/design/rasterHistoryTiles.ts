import { createCanvas, ctx2d } from '../../lib/media';

export const RASTER_HISTORY_TILE_SIZE = 64;

export interface RasterHistoryTile {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Immutable-by-convention grid. Updates replace only the tiles named by the independent history dirty set. */
export interface RasterHistorySnapshot {
  width: number;
  height: number;
  tileSize: number;
  tiles: ReadonlyMap<string, RasterHistoryTile>;
  /** Where the grid sits in the full buffer (rasterSurface.ts); absent = a full buffer at (0, 0). */
  geometry?: { x0: number; y0: number; fw: number; fh: number };
}

let copiedPixels = 0;
/** Pixels copied into history tiles since the previous history capture trace. */
export function takeRasterHistoryCopiedPixels(): number {
  const total = copiedPixels;
  copiedPixels = 0;
  return total;
}

export function tileKey(x: number, y: number): string {
  return `${x}:${y}`;
}

export function tileKeysForRect(x: number, y: number, width: number, height: number, tileSize = RASTER_HISTORY_TILE_SIZE): string[] {
  if (width <= 0 || height <= 0) return [];
  const x0 = Math.max(0, Math.floor(x / tileSize));
  const y0 = Math.max(0, Math.floor(y / tileSize));
  const x1 = Math.max(x0, Math.ceil((x + width) / tileSize) - 1);
  const y1 = Math.max(y0, Math.ceil((y + height) / tileSize) - 1);
  const keys: string[] = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) keys.push(tileKey(tx, ty));
  return keys;
}

function copyTile(source: HTMLCanvasElement, tx: number, ty: number, tileSize: number): RasterHistoryTile {
  const x = tx * tileSize, y = ty * tileSize;
  const width = Math.min(tileSize, source.width - x), height = Math.min(tileSize, source.height - y);
  const canvas = createCanvas(width, height);
  ctx2d(canvas).drawImage(source, x, y, width, height, 0, 0, width, height);
  copiedPixels += width * height;
  return { canvas, width, height };
}

export function snapshotRasterTiles(source: HTMLCanvasElement, tileSize = RASTER_HISTORY_TILE_SIZE, geometry?: RasterHistorySnapshot['geometry']): RasterHistorySnapshot {
  const tiles = new Map<string, RasterHistoryTile>();
  for (let y = 0; y < source.height; y += tileSize) {
    for (let x = 0; x < source.width; x += tileSize) tiles.set(tileKey(x / tileSize, y / tileSize), copyTile(source, x / tileSize, y / tileSize, tileSize));
  }
  return { width: source.width, height: source.height, tileSize, tiles, geometry };
}

export function updateRasterTiles(snapshot: RasterHistorySnapshot, source: HTMLCanvasElement, changedKeys: Iterable<string>): RasterHistorySnapshot {
  const tiles = new Map(snapshot.tiles);
  for (const key of new Set(changedKeys)) {
    const [tx, ty] = key.split(':').map(Number);
    if (!Number.isInteger(tx) || !Number.isInteger(ty) || tx < 0 || ty < 0) continue;
    const x = tx * snapshot.tileSize, y = ty * snapshot.tileSize;
    if (x >= source.width || y >= source.height) continue;
    tiles.set(key, copyTile(source, tx, ty, snapshot.tileSize));
  }
  return { width: source.width, height: source.height, tileSize: snapshot.tileSize, tiles, geometry: snapshot.geometry };
}

export function restoreRasterTiles(snapshot: RasterHistorySnapshot): HTMLCanvasElement {
  const canvas = createCanvas(snapshot.width, snapshot.height);
  const ctx = ctx2d(canvas);
  for (const [key, tile] of snapshot.tiles) {
    const [tx, ty] = key.split(':').map(Number);
    ctx.drawImage(tile.canvas, tx * snapshot.tileSize, ty * snapshot.tileSize);
  }
  return canvas;
}
