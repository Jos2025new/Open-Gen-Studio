import { parseTokenAlias } from './libraryTokens';
import { isKit, mentionableSubjects, type KitPiece } from './libraryTypes';
import type { DesignDoc, Subject } from './types';

/* Pure dependency graph, reverse usage index, cycle checks, and asset ownership across all kit versions. */

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
  const pieces = subject.pieces ?? [], pieceById = new Map(pieces.map((p) => [p.id, p]));
  const liveGroups = new Set(doc ? (doc.groups ?? []).filter((g) => doc.layers.some((l) => l.groupId === g.id)).map((g) => g.id) : (subject.groupIds ?? []));
  const kitIds: string[] = [], missingKitIds: string[] = [], assetIds: string[] = [], missingGroupIds: string[] = [];
  const tokenMap = new Map<string, string[]>(), addTok = (pid: string, t: string) => pushMap(tokenMap, pid, t);
  const tokens = subject.tokens;
  const linkToken = (ref: string): string | null => (ref.startsWith('token:') ? ref.slice(6) : tokens && Object.prototype.hasOwnProperty.call(tokens, ref) ? ref : null);
  for (const p of pieces) {
    if (p.kind === 'kit' && p.kitId) (byId.has(p.kitId) ? kitIds : missingKitIds).push(p.kitId);
    else if (p.kind === 'asset' && p.assetId) assetIds.push(p.assetId);
    else if (p.kind === 'component' && p.groupId && !liveGroups.has(p.groupId)) missingGroupIds.push(p.groupId);
    else if (p.kind === 'style' && p.values) {
      for (const v of Object.values(p.values)) { const t = parseTokenAlias(v); if (t) addTok(p.id, t); }
    }
  }
  const styleLinks: Array<[string, string]> = [];
  for (const l of subject.links ?? []) {
    const a = pieceById.get(l.from), b = pieceById.get(l.to);
    const ta = !a ? linkToken(l.from) : null, tb = !b ? linkToken(l.to) : null;
    if (a && (a.kind === 'component' || a.kind === 'style') && tb) addTok(a.id, tb);
    if (b && (b.kind === 'component' || b.kind === 'style') && ta) addTok(b.id, ta);
    if (a?.kind === 'component' && b?.kind === 'style') styleLinks.push([a.id, b.id]);
    if (b?.kind === 'component' && a?.kind === 'style') styleLinks.push([b.id, a.id]);
  }
  for (const [compId, styleId] of styleLinks) for (const t of tokenMap.get(styleId) ?? []) addTok(compId, t);
  const pieceTokens: Record<string, string[]> = {};
  const allToks: string[] = [];
  for (const [pid, list] of tokenMap) {
    const u = uniq(list);
    pieceTokens[pid] = u;
    allToks.push(...u);
  }
  const tokenIds = uniq(allToks);
  const missingTokenIds = tokenIds.filter((t) => !tokens || !Object.prototype.hasOwnProperty.call(tokens, t));
  return { kitIds: uniq(kitIds), missingKitIds: uniq(missingKitIds), assetIds: uniq(assetIds), missingGroupIds: uniq(missingGroupIds), pieceTokens, tokenIds, missingTokenIds };
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

/** Agent context lines for Library: mentionable @Name subjects plus a separate kit index (never @-mentioned). */
export function libraryContextLines(library: readonly Subject[], assets: Record<string, unknown>): string[] {
  const out: string[] = [];
  const named = mentionableSubjects(library).filter((s) => !s.capture || s.frontalAssetId);
  if (named.length) out.push(`library (mention as @Name; the app sends its image): ${named.map((s) => `@${s.name} (${s.kind ?? 'character'})${s.description ? ` — ${s.description}` : ''}`).join(', ')}`);
  const kits = library.filter((s) => isKit(s));
  if (kits.length) {
    const idx = buildLibraryIndex(library);
    const items = kits.map((k) => {
      const dep = idx.dependencies.get(k.id), parts: string[] = [];
      if (dep?.kitIds.length) parts.push(`kits: ${dep.kitIds.map((id) => `${id} "${idx.byId.get(id)?.name ?? id}"`).join(', ')}`);
      const pAssets = (k.pieces ?? []).filter((p) => p.kind === 'asset' && p.assetId);
      if (pAssets.length) parts.push(`${pAssets.length} asset${pAssets.length === 1 ? '' : 's'}`);
      const texts = (k.pieces ?? []).filter((p) => p.kind === 'text').length;
      if (texts) parts.push(`${texts} text${texts === 1 ? '' : 's'}`);
      const colors = (k.pieces ?? []).filter((p) => p.kind === 'color').length;
      if (colors) parts.push(`${colors} color${colors === 1 ? '' : 's'}`);
      const comps = (k.pieces ?? []).filter((p) => p.kind === 'component').length;
      if (comps) parts.push(`${comps} component${comps === 1 ? '' : 's'}`);
      const styles = (k.pieces ?? []).filter((p) => p.kind === 'style').length;
      if (styles) parts.push(`${styles} style${styles === 1 ? '' : 's'}`);
      if (k.tokens) {
        const keys = Object.keys(k.tokens);
        if (keys.length) {
          const groups = [...new Set(keys.map((n) => n.split('.')[0]))];
          parts.push(`tokens: ${keys.length} (${groups.join('/')})`);
        }
      }
      if (k.links?.length) parts.push(`${k.links.length} link${k.links.length === 1 ? '' : 's'}`);
      const missing = [
        ...(dep?.missingKitIds.map((id) => `kit:${id}`) ?? []),
        ...(dep?.missingGroupIds.map((id) => `group:${id}`) ?? []),
        ...(dep?.missingTokenIds.map((id) => `token:${id}`) ?? []),
        ...pAssets.filter((p) => !assets[p.assetId!]).map((p) => `asset:${p.assetId}`),
      ];
      return `${k.id} "${k.name}" (${k.kind}${k.draft ? ', draft' : ''}) — contains: ${parts.join(', ') || 'empty'}${missing.length ? `; missing: ${missing.join(', ')}` : ''}`;
    });
    out.push(`library kits (read/edit via library.kit.* commands): ${items.join(' | ')}`);
  }
  return out;
}
