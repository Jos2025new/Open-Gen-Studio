import { createDoc, newRasterLayer } from '../../src/engine/design/doc';
import { redo, record, dropHistory, undo, bytesOfSnapshots } from '../../src/engine/design/history';
import { deleteBuffers, getBuffer, setBuffer, snapshotHistoryBuffers } from '../../src/engine/design/raster';
import { createCanvas, ctx2d } from '../../src/lib/media';
import { takeRasterHistoryCopiedPixels } from '../../src/engine/design/rasterHistoryTiles';
import type { RasterHistorySnapshot } from '../../src/engine/design/rasterHistoryTiles';

function paintProbe(canvas: HTMLCanvasElement): void {
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 64) {
    for (let x = 0; x < canvas.width; x += 64) {
      const alpha = ((x / 64 + y / 64) % 4 + 1) / 5;
      ctx.fillStyle = `rgba(${(x * 17) % 256},${(y * 29) % 256},${(x + y) % 256},${alpha})`;
      ctx.fillRect(x + 4, y + 4, 48, 48);
    }
  }
  ctx.fillStyle = 'rgba(240,40,170,.63)';
  ctx.fillRect(61.25, 59.5, 10.5, 13.25);
  ctx.fillStyle = '#16a085';
  ctx.beginPath();
  ctx.arc(511.4, 512.6, 170.3, 0, Math.PI * 2);
  ctx.fill();
}

function pixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  return ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
}

function difference(a: Uint8ClampedArray, b: Uint8ClampedArray): { differentPixels: number; differentChannels: number; maxChannelDelta: number } {
  let differentPixels = 0, differentChannels = 0, maxChannelDelta = 0;
  for (let i = 0; i < a.length; i += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(a[i + channel] - b[i + channel]);
      if (delta) { changed = true; differentChannels++; maxChannelDelta = Math.max(maxChannelDelta, delta); }
    }
    if (changed) differentPixels++;
  }
  return { differentPixels, differentChannels, maxChannelDelta };
}

function uniqueTileCount(...snapshots: Array<ReadonlyMap<string, RasterHistorySnapshot>>): number {
  const refs = new Set<unknown>();
  for (const snapshot of snapshots) for (const grid of snapshot.values()) for (const tile of grid.tiles.values()) refs.add(tile);
  return refs.size;
}

/** Browser-only RGB/alpha parity probe for the in-memory undo tile history. */
export async function runRasterHistoryTiles(): Promise<Record<string, unknown>> {
  const width = 1024, height = 1024;
  const layer = newRasterLayer('Tile history probe', { x: 0, y: 0, width, height }, { width, height });
  const doc = { ...createDoc('Tile history probe', width, height), layers: [layer], activeLayerId: layer.id };
  const before = createCanvas(width, height);
  paintProbe(before);
  const expectedBefore = pixels(before);
  let initialCopyPixels = 0, editCopyPixels = 0;
  try {
    setBuffer(layer.id, before, false);
    const captureStart = performance.now();
    record(doc);
    const captureMs = performance.now() - captureStart;
    initialCopyPixels = takeRasterHistoryCopiedPixels();
    const baseGrid = snapshotHistoryBuffers([layer.id]);

    const edited = createCanvas(width, height);
    ctx2d(edited).drawImage(before, 0, 0);
    ctx2d(edited).fillStyle = 'rgba(25,210,90,.37)';
    ctx2d(edited).fillRect(66.25, 66.5, 19.5, 20.25);
    const expectedEdited = pixels(edited);
    const editStart = performance.now();
    setBuffer(layer.id, edited, false, { x0: 66, y0: 66, x1: 86, y1: 87 });
    const editGrid = snapshotHistoryBuffers([layer.id]);
    const editMs = performance.now() - editStart;
    editCopyPixels = takeRasterHistoryCopiedPixels();

    const undoStart = performance.now();
    undo({ ...doc, updatedAt: doc.updatedAt + 1 });
    const undoMs = performance.now() - undoStart;
    const afterUndo = getBuffer(layer.id)!;
    const undoDiff = difference(expectedBefore, pixels(afterUndo));

    const redoStart = performance.now();
    redo(doc);
    const redoMs = performance.now() - redoStart;
    const afterRedo = getBuffer(layer.id)!;
    const redoDiff = difference(expectedEdited, pixels(afterRedo));
    const changedTileRefs = [...baseGrid.get(layer.id)!.tiles.keys()].filter((key) => baseGrid.get(layer.id)!.tiles.get(key) !== editGrid.get(layer.id)!.tiles.get(key));

    return {
      mode: 'raster-history-tiles', width, height, tileSize: 64,
      timingsMs: { capture: captureMs, localEditSnapshot: editMs, undo: undoMs, redo: redoMs },
      copiedPixels: { initialSnapshot: initialCopyPixels, localEdit: editCopyPixels },
      grid: { initialTiles: baseGrid.get(layer.id)!.tiles.size, changedTileKeys: changedTileRefs, uniqueTilesAcrossSnapshots: uniqueTileCount(baseGrid, editGrid), uniqueTileBytes: bytesOfSnapshots([{ buffers: baseGrid }, { buffers: editGrid }]) },
      parity: { undo: { ...undoDiff, exact: undoDiff.differentChannels === 0 }, redo: { ...redoDiff, exact: redoDiff.differentChannels === 0 } },
    };
  } finally {
    dropHistory(doc.id);
    await deleteBuffers([layer.id]);
  }
}
