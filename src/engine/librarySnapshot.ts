import { uid } from '../lib/id';
import { blobDb } from '../lib/idb';
import { isUnreadable, rasterBufferIds } from './design/raster';
import type { KitActor, KitTokens, LibrarySpace } from './libraryTypes';
import type { DesignDoc, Graph, Layer } from './types';

export interface KitVersionSnapshot {
  id: string; subjectId: string; at: number; by: KitActor; space: LibrarySpace;
  label?: string; graph?: Graph; kits?: string[]; tokens?: KitTokens; doc?: DesignDoc;
  docRev?: string; storedRasterIds?: string[]; revs?: Record<string, number>;
}
export const rKey = (id: string) => `raster:${id}`, vKey = (id: string) => `libver:${id}`;

export const cleanupKeys = (keys: readonly string[]) => (keys.length ? blobDb.delMany([...new Set(keys)]).catch(() => undefined) : Promise.resolve());
export async function withCleanup<T>(fn: (written: string[]) => Promise<T>): Promise<T> {
  const written: string[] = [];
  try { return await fn(written); } catch (err) { await cleanupKeys(written); throw err; }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);

export async function writeVerified(key: string, blob: Blob, expected: Uint8Array, written: string[]): Promise<void> {
  if (await blobDb.get(key)) throw new Error(`Refusing to overwrite existing blob "${key}".`);
  written.push(key);
  await blobDb.set(key, blob);
  const check = await blobDb.get(key);
  if (!check || !sameBytes(expected, new Uint8Array(await check.arrayBuffer()))) throw new Error(`Could not verify saved blob "${key}" (writer lock missing or storage error).`);
}
export async function readKitVersion(versionId: string): Promise<KitVersionSnapshot | null> {
  const blob = await blobDb.get(vKey(versionId));
  if (!blob) return null;
  try { return JSON.parse(await blob.text()) as KitVersionSnapshot; } catch { throw new Error(`Version "${versionId}" blob is unreadable.`); }
}

const paintBaseIdsOf = (layers: readonly Layer[]) => new Set(layers.flatMap((l) => (l.type === 'raster' && l.paintBaseId ? [l.paintBaseId] : l.type === 'vector' && l.pixelMask?.paintBaseId ? [l.pixelMask.paintBaseId] : [])));
const rasterRevMap = (layers: readonly Layer[]) => new Map(layers.flatMap((l): Array<[string, number]> => (l.type === 'raster' ? [[l.id, l.rev]] : l.type === 'vector' && l.pixelMask ? [[l.pixelMask.id, l.pixelMask.rev]] : [])));

export const expectedRasterIds = (snap: KitVersionSnapshot): Set<string> =>
  !snap.doc ? new Set() : snap.storedRasterIds !== undefined ? new Set([...snap.storedRasterIds, ...paintBaseIdsOf(snap.doc.layers)]) : new Set(rasterBufferIds(snap.doc.layers));

export function remapDoc(doc: DesignDoc, map: ReadonlyMap<string, string>, opts: { newDocId: boolean; library?: DesignDoc['library'] }): DesignDoc {
  const { library: _drop, view: _view, ...rest } = structuredClone(doc), remap = (id: string) => map.get(id) ?? id;
  const layers: Layer[] = rest.layers.map((l) =>
    l.type === 'raster' ? { ...l, id: remap(l.id), ...(l.paintBaseId ? { paintBaseId: remap(l.paintBaseId) } : {}) }
      : l.type === 'vector' && l.pixelMask ? { ...l, pixelMask: { ...l.pixelMask, id: remap(l.pixelMask.id), ...(l.pixelMask.paintBaseId ? { paintBaseId: remap(l.pixelMask.paintBaseId) } : {}) } }
        : l,
  );
  const groups = rest.groups?.map((g) => ({ ...g, ...(g.keptHidden ? { keptHidden: g.keptHidden.map(remap) } : {}), ...(g.keptLocked ? { keptLocked: g.keptLocked.map(remap) } : {}) }));
  return { ...rest, ...(groups ? { groups } : {}), id: opts.newDocId ? uid('doc') : rest.id, layers, activeLayerId: rest.activeLayerId ? remap(rest.activeLayerId) : null, ...(rest.board ? { board: { ...rest.board, at: Object.fromEntries(Object.entries(rest.board.at).map(([id, a]) => [id, { ...a, layer: remap(a.layer) }])) } } : {}), ...(opts.library ? { library: opts.library } : {}) };
}

export async function copyDocPixels(doc: DesignDoc, reuseFrom: DesignDoc | null | undefined, expectedIds: ReadonlySet<string> | undefined, written: string[]): Promise<{ map: Map<string, string>; storedIds: string[] }> {
  const ids = rasterBufferIds(doc.layers), baseIds = paintBaseIdsOf(doc.layers), revMap = rasterRevMap(doc.layers);
  for (const id of ids) if (isUnreadable(id)) throw new Error(`Cannot save: layer pixels "${id}" are unreadable.`);
  const prevEntries: Array<[string, Uint8Array]> = [];
  if (reuseFrom) for (const pid of rasterBufferIds(reuseFrom.layers)) { const b = await blobDb.get(rKey(pid)); if (b) prevEntries.push([pid, new Uint8Array(await b.arrayBuffer())]); }
  const usedPrev = new Set<string>(), map = new Map<string, string>(), storedIds: string[] = [];
  for (const id of ids) {
    const src = await blobDb.get(rKey(id));
    if (!src) {
      if (baseIds.has(id) || (expectedIds ? expectedIds.has(id) : (revMap.get(id) ?? 0) > 0)) throw new Error(`Missing expected pixel blob "${rKey(id)}".`);
      map.set(id, uid('lyr')); continue;
    }
    const bytes = new Uint8Array(await src.arrayBuffer()), match = prevEntries.find(([pid, pb]) => !usedPrev.has(pid) && sameBytes(bytes, pb));
    if (match) { usedPrev.add(match[0]); map.set(id, match[0]); storedIds.push(match[0]); }
    else { const nextId = uid('lyr'); await writeVerified(rKey(nextId), new Blob([bytes], { type: src.type || 'image/png' }), bytes, written); map.set(id, nextId); storedIds.push(nextId); }
  }
  return { map, storedIds };
}
