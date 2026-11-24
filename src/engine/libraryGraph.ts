import { parseTokenAlias } from './libraryTokens';
import { isKit, mentionableSubjects } from './libraryTypes';
import type { DesignDoc, Subject } from './types';

/* Pure dependency graph, reverse usage index, cycle checks, and asset ownership across all versions. */

export interface KitDependencies {
  kitIds: string[]; missingKitIds: string[]; assetIds: string[];
  missingGroupIds: string[]; pieceTokens: Record<string, string[]>; tokenIds: string[]; missingTokenIds: string[];
}
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

/** Direct kit, asset, group, and component/style -> token dependencies of one entry. */
export function kitDependencies(subject: Subject, library: readonly Subject[] | ReadonlyMap<string, Subject>, doc?: DesignDoc): KitDependencies {
  const byId = library instanceof Map ? library : new Map((library as readonly Subject[]).map((s) => [s.id, s]));
  const nodes = subject.graph?.nodes ?? [], byNode = new Map(nodes.map((n) => [n.id, n]));
  const liveGroups = new Set(doc ? (doc.groups ?? []).filter((g) => doc.layers.some((l) => l.groupId === g.id)).map((g) => g.id) : (subject.groupIds ?? []));
  const kitIds: string[] = [], missingKitIds: string[] = [], assetIds: string[] = [], missingGroupIds: string[] = [];
  const tokenMap = new Map<string, string[]>(), addTok = (nid: string, t: string) => pushMap(tokenMap, nid, t);
  const tokens = subject.tokens;
  for (const kid of subject.kits ?? []) (byId.has(kid) ? kitIds : missingKitIds).push(kid);
  for (const n of nodes) {
    const d = n.data;
    if (d.kind === 'asset' && d.assetId) assetIds.push(d.assetId);
    else if (d.kind === 'part') {
      if (d.partKind === 'component' && d.groupId && !liveGroups.has(d.groupId)) missingGroupIds.push(d.groupId);
      if (d.values) for (const v of Object.values(d.values)) { const t = parseTokenAlias(v); if (t) addTok(n.id, t); }
    }
  }
  for (const e of subject.graph?.edges ?? []) {
    const a = byNode.get(e.source)?.data, b = byNode.get(e.target)?.data;
    if (a?.kind === 'part' && b?.kind === 'part') {
      if (a.partKind === 'component' && b.partKind === 'style') for (const t of tokenMap.get(e.target) ?? []) addTok(e.source, t);
      if (b.partKind === 'component' && a.partKind === 'style') for (const t of tokenMap.get(e.source) ?? []) addTok(e.target, t);
    }
  }
  const pieceTokens: Record<string, string[]> = {}, allToks: string[] = [];
  for (const [nid, list] of tokenMap) { const u = uniq(list); pieceTokens[nid] = u; allToks.push(...u); }
  const tokenIds = uniq(allToks);
  const missingTokenIds = tokenIds.filter((t) => !tokens || !Object.prototype.hasOwnProperty.call(tokens, t));
  return { kitIds: uniq(kitIds), missingKitIds: uniq(missingKitIds), assetIds: uniq(assetIds), missingGroupIds: uniq(missingGroupIds), pieceTokens, tokenIds, missingTokenIds };
}

/** Entries that directly reference `id` via `kits`. */
export function kitUsedBy(id: string, library: readonly Subject[]): Subject[] {
  return library.filter((s) => s.id !== id && (s.kits ?? []).includes(id));
}

/** Reject direct or transitive kit containment cycles before saving. */
export function wouldCreateKitCycle(library: readonly Subject[], parentId: string, nextKits: readonly string[]): { ok: true } | { ok: false; reason: string } {
  const byId = new Map(library.map((s) => [s.id, s]));
  for (const target of uniq(nextKits)) {
    if (target === parentId) return { ok: false, reason: `Entry "${parentId}" cannot contain itself.` };
    const stack = [target], seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === parentId) return { ok: false, reason: `Cycle detected: "${target}" already depends on "${parentId}".` };
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const kid of byId.get(cur)?.kits ?? []) if (!seen.has(kid)) stack.push(kid);
    }
  }
  return { ok: true };
}

/** Every asset referenced by a Library entry in its current state and across ALL saved versions. */
export function subjectAssetIds(subject: Subject): string[] {
  const graphAssets = (subject.graph?.nodes ?? []).map((n) => (n.data.kind === 'asset' ? n.data.assetId ?? undefined : undefined));
  return uniq([
    subject.frontalAssetId, ...subject.refAssetIds, subject.videoAssetId,
    ...graphAssets,
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

/** Agent context lines for Library: mentionable @Name subjects plus total kit count (details via read/list). */
export function libraryContextLines(library: readonly Subject[], _assets?: Record<string, unknown>): string[] {
  const out: string[] = [];
  const named = mentionableSubjects(library).filter((s) => !s.capture || s.frontalAssetId);
  if (named.length) out.push(`library (mention as @Name; the app sends its image): ${named.map((s) => `@${s.name} (${s.kind ?? 'character'})${s.description ? ` — ${s.description}` : ''}`).join(', ')}`);
  const kits = library.filter(isKit);
  if (kits.length) out.push(`library items: ${kits.length} (use library.item.list and library.item.read to inspect)`);
  return out;
}
