/*
 * The editor's cache for 'below' FX (the adjustment that filters everything under it). Its result is kept while the
 * composite under it is the same: the key lists every layer, FX layer and buffer version drawn before it, plus the
 * scale and page size (render.ts builds it). Layer and FX objects are replaced, never mutated, when they change, so
 * identity is enough; pixels are covered by their buffer versions. Moving a layer above the FX keeps its result.
 */

import { editorCacheBudget } from './cacheBudget';

interface Entry { key: unknown[]; canvas: HTMLCanvasElement }
/** Kept for compatibility with tests: the budget is now in bytes (see cacheBudget.ts). */
export const BELOW_CACHE_PX = 48_000_000;
const cache = new Map<string, Entry>();

export function cachedBelow(id: string, key: unknown[]): HTMLCanvasElement | undefined {
  const hit = cache.get(id);
  if (!hit || hit.key.length !== key.length || !hit.key.every((k, i) => k === key[i])) return undefined;
  cache.delete(id); cache.set(id, hit); // most recently used last
  editorCacheBudget.touch(`below:${id}`);
  return hit.canvas;
}

/** Keeps `canvas`, which must not be drawn on afterwards (the caller passes a copy). */
export function keepBelow(id: string, key: unknown[], canvas: HTMLCanvasElement): void {
  cache.delete(id);
  cache.set(id, { key, canvas });
  editorCacheBudget.put(`below:${id}`, canvas.width * canvas.height * 4, () => cache.delete(id));
}

/** Tests only. */
export function clearBelowCache(): void { for (const id of [...cache.keys()]) editorCacheBudget.remove(`below:${id}`); cache.clear(); }
