import type { KitPiece } from './libraryTypes';
import type { Subject } from './types';

/* Pure dependency graph, reverse usage index, cycle checks, and asset ownership across all kit versions. */

export interface KitDependencies { kitIds: string[]; missingKitIds: string[]; assetIds: string[]; }
export interface LibraryIndex {
  byId: Map<string, Subject>;
  dependencies: Map<string, KitDependencies>;
  usedBy: Map<string, Subject[]>;
  missingRefs: Map<string, string[]>;
  assetIds: Set<string>;
  assetOwners: Map<string, Subject[]>;
}

const uniq = (ids: Iterable<string | undefined>): string[] => [...new Set([...ids].filter((x): x is string => Boolean(x)))];
const pushMap = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const list = m.get(k); if (list) list.push(v); else m.set(k, [v]); };

/** Direct kit references (`pieces` with `kind: 'kit'`) and direct asset references of one entry. */
export function kitDependencies(subject: Subject, library: readonly Subject[] | ReadonlyMap<string, Subject>): KitDependencies {
  const byId = library instanceof Map ? library : new Map((library as readonly Subject[]).map((s) => [s.id, s]));
  const kitIds: string[] = [], missingKitIds: string[] = [], assetIds: string[] = [];
  for (const p of subject.pieces ?? []) {
    if (p.kind === 'kit' && p.kitId) (byId.has(p.kitId) ? kitIds : missingKitIds).push(p.kitId);
    else if (p.kind === 'asset' && p.assetId) assetIds.push(p.assetId);
  }
  return { kitIds: uniq(kitIds), missingKitIds: uniq(missingKitIds), assetIds: uniq(assetIds) };
}

/** Entries that directly reference `id` via a `kit` piece. */
export function kitUsedBy(id: string, library: readonly Subject[]): Subject[] {
  return library.filter((s) => s.id !== id && (s.pieces ?? []).some((p) => p.kind === 'kit' && p.kitId === id));
}

/** Reject direct or transitive kit containment cycles before saving or updating pieces. */
export function wouldCreateKitCycle(library: readonly Subject[], parentId: string, nextPieces: readonly KitPiece[]): { ok: true } | { ok: false; reason: string } {
  const byId = new Map(library.map((s) => [s.id, s]));
  for (const target of uniq(nextPieces.filter((p) => p.kind === 'kit').map((p) => p.kitId))) {
    if (target === parentId) return { ok: false, reason: `Kit "${parentId}" cannot contain itself.` };
    const stack = [target], seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === parentId) return { ok: false, reason: `Cycle detected: "${target}" already depends on "${parentId}".` };
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const p of byId.get(cur)?.pieces ?? []) if (p.kind === 'kit' && p.kitId && !seen.has(p.kitId)) stack.push(p.kitId);
    }
  }
  return { ok: true };
}

/** Every asset referenced by a Library entry in its current state and across ALL saved versions. */
export function subjectAssetIds(subject: Subject): string[] {
  return uniq([
    subject.frontalAssetId, ...subject.refAssetIds, subject.videoAssetId,
    ...(subject.pieces ?? []).map((p) => (p.kind === 'asset' ? p.assetId : undefined)),
    ...(subject.versions ?? []).flatMap((v) => v.assetIds),
  ]);
}

/** Map of assetId -> Library entries (subjects and kits, all versions) that reference it. */
export function libraryAssetOwners(library: readonly Subject[]): Map<string, Subject[]> {
  const owners = new Map<string, Subject[]>();
  for (const s of library) for (const id of subjectAssetIds(s)) pushMap(owners, id, s);
  return owners;
}

/** Set of all asset IDs currently protected by any Library entry (all versions included). */
export function libraryAssetSet(library: readonly Subject[]): Set<string> {
  return new Set(libraryAssetOwners(library).keys());
}

/** Derived in-memory graph index over `st.library`. */
export function buildLibraryIndex(library: readonly Subject[]): LibraryIndex {
  const byId = new Map(library.map((s) => [s.id, s]));
  const dependencies = new Map<string, KitDependencies>(), usedBy = new Map<string, Subject[]>(), missingRefs = new Map<string, string[]>();
  for (const s of library) {
    const dep = kitDependencies(s, byId);
    dependencies.set(s.id, dep);
    if (dep.missingKitIds.length) missingRefs.set(s.id, dep.missingKitIds);
    for (const target of dep.kitIds) pushMap(usedBy, target, s);
  }
  const assetOwners = libraryAssetOwners(library);
  return { byId, dependencies, usedBy, missingRefs, assetIds: new Set(assetOwners.keys()), assetOwners };
}
