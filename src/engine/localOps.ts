/* Local operations: frames, grid split, fx, join clips (moved out of jobs.ts, Opus #4). */
import { AbortedError } from '../lib/http';
import { assetBlobKey } from '../lib/idb';
import { LOCAL_WRITE } from '../lib/disk';
import { disk, diskAvailable } from '../lib/disk';
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d } from '../lib/media';
import { fxOnCanvas } from './fx/op';
import { InputError } from './errors';
import { cellRects, gridShape } from './sheet';
import type { Generation } from './types';
import { addAssets, patchGeneration, useStore } from '../store/store';
import { ensureAssetBlob, frameInput, mediaInput, storeOutput } from './assetIO';

const get = useStore.getState;

/** Local operations (frames, grid split) run in the browser for free; they never reach a provider. */
export async function runLocalOp(g: Generation, signal: AbortSignal): Promise<string[]> {
  const { id, sourceAssetId, params } = g.op!;
  if (id === 'join_clips') return joinClips(g, [sourceAssetId, ...String(params.clips ?? '').split(',').filter(Boolean)], signal, String(params.music ?? '') || undefined, params.loudness === 'social');
  const images: Array<{ blob: Blob; width: number; height: number }> = [];
  if (id === 'extract_frame') {
    const seconds = parseFloat(String(params.seconds ?? '').replace(',', '.'));
    const which = params.which === 'first' ? 'first' : params.which === 'time' && Number.isFinite(seconds) ? seconds : 'last';
    images.push(await frameInput(sourceAssetId, which));
  } else if (id === 'grid_split') {
    // Cells come from sheet.ts: squares (2, 3), 2×3 (six views), or one row of 3 or 4 views (a turnaround sheet).
    const src = await blobToCanvas((await mediaInput(sourceAssetId)).blob);
    for (const cell of cellRects(gridShape(params.grid), src.width, src.height)) {
      const c = createCanvas(cell.w, cell.h);
      ctx2d(c).drawImage(src, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
      images.push({ blob: await canvasToBlob(c, 'image/png'), width: cell.w, height: cell.h });
    }
  } else if (id === 'fx') {
    const out = fxOnCanvas(await blobToCanvas((await mediaInput(sourceAssetId)).blob), params);
    images.push({ blob: await canvasToBlob(out, 'image/png'), width: out.width, height: out.height });
  } else {
    throw new Error(`${id} is not a local operation`);
  }
  if (signal.aborted) throw new AbortedError();
  const assets = await Promise.all(images.map((f) => storeOutput({ blob: f.blob, mime: 'image/png' }, g, 'image', { width: f.width, height: f.height })));
  assets.forEach((a) => (a.origin = 'frame'));
  addAssets(assets);
  return assets.map((a) => a.id);
}

/** join_clips: the local server joins the clips with ffmpeg; no server, no join. */
async function joinClips(g: Generation, ids: string[], signal: AbortSignal, music?: string, loudnorm = false): Promise<string[]> {
  if (ids.length < 2) throw new InputError('JOIN_CLIPS', 'Join clips needs at least two clips.');
  if (!(await diskAvailable())) throw new InputError('JOIN_UNAVAILABLE', 'Joining clips needs the local app server (npm run dev or npm run preview).');
  patchGeneration(g.id, { statusText: 'Joining clips' });
  for (const id of ids) {
    if (get().assets[id]?.kind !== 'video') throw new InputError('JOIN_CLIPS', 'Join clips only takes videos.');
    await disk.setBlob(assetBlobKey(id), await ensureAssetBlob(id));
  }
  if (music) {
    if (get().assets[music]?.kind !== 'audio') throw new InputError('JOIN_CLIPS', 'The music under the joined video must be audio.');
    await disk.setBlob(assetBlobKey(music), await ensureAssetBlob(music));
  }
  const res = await fetch('/x/store/join', { method: 'POST', signal, body: JSON.stringify({ keys: ids.map(assetBlobKey), ...(music ? { music: assetBlobKey(music) } : {}), ...(loudnorm ? { loudnorm: true } : {}) }), headers: { 'Content-Type': 'application/json', ...LOCAL_WRITE } });
  if (!res.ok) throw new InputError(res.status === 501 ? 'JOIN_UNAVAILABLE' : 'JOIN_FAILED', `Could not join the clips: ${(await res.text()).slice(0, 300)}`);
  const first = get().assets[ids[0]];
  const asset = await storeOutput({ blob: await res.blob(), mime: 'video/mp4' }, g, 'video', { width: first?.width ?? 0, height: first?.height ?? 0 });
  addAssets([asset]);
  return [asset.id];
}
