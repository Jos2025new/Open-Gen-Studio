import { bufferVersion } from './raster';

/*
 * Alpha of a layer's pixel buffer for hit tests. Reading pixels synchronizes the canvas with the GPU: a press on a
 * layer with a composition pending cost ~2 s per read. The alpha is therefore read once per content version of the
 * buffer (raster.ts bumps the version on every write) and reused by each later press until the pixels change.
 */

interface Entry { canvas: HTMLCanvasElement; version: number; alpha: Uint8ClampedArray }

/** Budget in bytes of alpha kept (one byte per pixel): oldest entries are dropped first. */
export const ALPHA_BUDGET_BYTES = 64 * 1024 * 1024;
const entries = new Map<string, Entry>();
let stored = 0;
/** Reads of the buffer, for tests. */
export const alphaReads = { count: 0 };

export function bufferAlpha(layerId: string, buf: HTMLCanvasElement): Uint8ClampedArray {
  const version = bufferVersion(layerId);
  const hit = entries.get(layerId);
  if (hit && hit.canvas === buf && hit.version === version) {
    entries.delete(layerId); entries.set(layerId, hit); // most recently used last
    return hit.alpha;
  }
  alphaReads.count++;
  const { width: w, height: h } = buf;
  const data = buf.getContext('2d')?.getImageData(0, 0, w, h).data;
  const alpha = new Uint8ClampedArray(w * h);
  if (data) for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  if (hit) { stored -= hit.alpha.length; entries.delete(layerId); }
  const size = alpha.length;
  if (size <= ALPHA_BUDGET_BYTES) {
    while (entries.size && stored + size > ALPHA_BUDGET_BYTES) {
      const [key, old] = entries.entries().next().value!;
      stored -= old.alpha.length; entries.delete(key);
    }
    entries.set(layerId, { canvas: buf, version, alpha }); stored += size;
  }
  return alpha;
}
