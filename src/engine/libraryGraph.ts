import { parseTokenAlias } from './libraryTokens';
import { isKit, mentionableSubjects } from './libraryTypes';
import type { Asset, DesignDoc, Subject } from './types';

/* Pure dependency graph, reverse usage, cycle checks, asset ownership across versions, and plain-text index. */
export interface KitDependencies {
  kitIds: string[]; missingKitIds: string[]; assetIds: string[];
  missingGroupIds: string[]; pieceTokens: Record<string, string[]>; tokenIds: string[]; missingTokenIds: string[];
}

const uniq = (ids: Iterable<string | undefined>): string[] => [...new Set([...ids].filter((x): x is string => Boolean(x)))];
const pushMap = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const list = m.get(k); if (list) list.push(v); else m.set(k, [v]); };
export const shortText = (s: string, max = 120): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

export function kitDependencies(subject: Subject, library: readonly Subject[] | ReadonlyMap<string, Subject>, doc?: DesignDoc): KitDependencies {
  const byId = library instanceof Map ? library : new Map((library as readonly Subject[]).map((s) => [s.id, s]));
  const nodes = subject.graph?.nodes ?? [], byNode = new Map(nodes.map((n) => [n.id, n]));
  const liveGroups = new Set(doc ? (doc.groups ?? []).filter((g) => doc.layers.some((l) => l.groupId === g.id)).map((g) => g.id) : (subject.groupIds ?? []));
  const kitIds: string[] = [], missingKitIds: string[] = [], assetIds: string[] = [], missingGroupIds: string[] = [];
  const tokenMap = new Map<string, string[]>(), addTok = (nid: string, t: string) => pushMap(tokenMap, nid, t);
  for (const kid of subject.kits ?? []) (byId.has(kid) ? kitIds : missingKitIds).push(kid);
  for (const { id, data: d } of nodes) {
    if (d.kind === 'asset' && d.assetId) assetIds.push(d.assetId);
    else if (d.kind === 'part') {
      if (d.partKind === 'component' && d.groupId && !liveGroups.has(d.groupId)) missingGroupIds.push(d.groupId);
      if (d.values) for (const v of Object.values(d.values)) { const t = parseTokenAlias(v); if (t) addTok(id, t); }
    }
  }
  for (const e of subject.graph?.edges ?? []) {
    const a = byNode.get(e.source)?.data, b = byNode.get(e.target)?.data;
    if (a?.kind !== 'part' || b?.kind !== 'part') continue;
    if (a.partKind === 'component' && b.partKind === 'style') for (const t of tokenMap.get(e.target) ?? []) addTok(e.source, t);
    if (b.partKind === 'component' && a.partKind === 'style') for (const t of tokenMap.get(e.source) ?? []) addTok(e.target, t);
  }
  const pieceTokens: Record<string, string[]> = {}, allToks: string[] = [];
  for (const [nid, list] of tokenMap) { const u = uniq(list); pieceTokens[nid] = u; allToks.push(...u); }
  const tokenIds = uniq(allToks), tokens = subject.tokens;
  const missingTokenIds = tokenIds.filter((t) => !tokens || !Object.prototype.hasOwnProperty.call(tokens, t));
  return { kitIds: uniq(kitIds), missingKitIds: uniq(missingKitIds), assetIds: uniq(assetIds), missingGroupIds: uniq(missingGroupIds), pieceTokens, tokenIds, missingTokenIds };
}

export const kitUsedBy = (id: string, library: readonly Subject[]): Subject[] => library.filter((s) => s.id !== id && (s.kits ?? []).includes(id));

export function wouldCreateKitCycle(library: readonly Subject[], parentId: string, nextKits: readonly string[], required: readonly string[] = []): { ok: true } | { ok: false; reason: string } {
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
  for (const id of required) {
    const item = byId.get(id);
    if (!item || !isKit(item)) return { ok: false, reason: `No Library kit "${id}".` };
  }
  return { ok: true };
}

export function subjectAssetIds(subject: Subject): string[] {
  const gAssets = (subject.graph?.nodes ?? []).map((n) => (n.data.kind === 'asset' ? n.data.assetId ?? undefined : undefined));
  return uniq([subject.frontalAssetId, ...subject.refAssetIds, subject.videoAssetId, ...gAssets, ...(subject.versions ?? []).flatMap((v) => v.assetIds)]);
}

export function libraryAssetOwners(library: readonly Subject[]): Map<string, Subject[]> {
  const owners = new Map<string, Subject[]>();
  for (const s of library) for (const id of subjectAssetIds(s)) pushMap(owners, id, s);
  return owners;
}
export const libraryAssetSet = (library: readonly Subject[]): Set<string> => new Set(libraryAssetOwners(library).keys());

const assetMeta = (assets: Record<string, unknown>, aid?: string | null): string => {
  const a = aid && assets[aid] && typeof assets[aid] === 'object' ? (assets[aid] as Partial<Asset>) : undefined;
  return a ? `${a.width && a.height ? ` ${a.width}x${a.height}` : ''}${a.origin ? ` (${a.origin})` : ''}` : '';
};
function docSummaryLines(doc: DesignDoc, assets: Record<string, unknown>, seen: ReadonlySet<string>, groupWord: string): string[] {
  const fonts = uniq(doc.layers.map((l) => (l.type === 'text' ? l.fontFamily : undefined)));
  const colors = uniq(doc.layers.flatMap((l) => {
    if (l.type === 'text') return [l.color];
    if (l.type === 'raster') return [l.pageFill?.color, ...(l.paintStrokes?.map((s) => s.color) ?? [])];
    if (l.type !== 'vector') return [];
    const stops = (g?: { stops: Array<{ color: string }> }) => g?.stops.map((x) => x.color) ?? [];
    return [...l.shapes.flatMap((s) => [s.fill ?? undefined, s.stroke ?? undefined, ...stops(s.fillGradient), ...stops(s.strokeGradient)]), ...(l.strokes?.map((s) => s.color) ?? [])];
  }));
  const f = fonts.length ? `, fonts: ${fonts.join(', ')}` : '', c = colors.length ? `, colors: ${colors.join(', ')}` : '';
  const out = [`doc: ${doc.width}x${doc.height}, bg ${doc.background ?? 'none'}, ${doc.layers.length} layers${f}${c}`];
  for (const g of (doc.groups ?? []).filter((gr) => doc.layers.some((l) => l.groupId === gr.id))) out.push(`${groupWord} ${g.id} "${shortText(g.name, 60)}"`);
  for (const aid of uniq(doc.layers.map((l) => ('sourceAssetId' in l ? l.sourceAssetId : undefined)))) if (!seen.has(aid)) out.push(`image ${aid}${assetMeta(assets, aid)}`);
  return out;
}

/** Pure plain-text index derived on read: properties, relations, origin, versions, usedBy, missing; line-capped at maxChars. */
export function formatLibraryItemIndex(subject: Subject, library: readonly Subject[], assets: Record<string, unknown>, maxChars = 2500, doc?: DesignDoc): { text: string; truncated: boolean } {
  const byId = new Map(library.map((s) => [s.id, s])), dep = kitDependencies(subject, byId, doc), usedBy = kitUsedBy(subject.id, library);
  const lines: string[] = [`${subject.id} "${shortText(subject.name, 100)}" (${subject.kind ?? 'item'}${subject.draft ? ', draft' : ''})`];
  if (subject.description) lines.push(`description: ${shortText(subject.description, 200)}`);
  if (subject.origin) lines.push(`origin: ${subject.origin.space} by ${subject.origin.by}${subject.origin.sessionTitle ? ` (${shortText(subject.origin.sessionTitle, 60)})` : ''}${subject.copiedFrom ? `, copiedFrom ${subject.copiedFrom}` : ''}`);
  const vers = subject.versions ?? [];
  lines.push(`versions: ${vers.length}${subject.versionId ? ` (current ${subject.versionId})` : ''}${vers.length ? ` — ${vers.slice(-3).map((v) => `${v.id}:${v.space}/${v.by}${v.label ? ` "${shortText(v.label, 40)}"` : ''}`).join(', ')}` : ''}`);
  // Belonging to the entry is itself a relation, declared even while it is empty; links and contains are the explicit ones.
  const count = (doc?.layers.length ?? 0) + (subject.graph?.nodes.length ?? 0) + (subject.kits?.length ?? 0) + Object.keys(subject.tokens ?? {}).length;
  lines.push(`members: ${count || 'none yet'}${count ? ' (everything listed below belongs to this entry)' : ''}`);
  if (doc) lines.push(...docSummaryLines(doc, assets, new Set(dep.assetIds), isKit(subject) && subject.kind !== 'moodboard' ? 'component' : 'group'));
  for (const [k, tok] of Object.entries(subject.tokens ?? {})) lines.push(`token ${k} (${tok.type}): ${shortText(String(tok.value), 80)}`);
  const nodes = subject.graph?.nodes ?? [], byNode = new Map(nodes.map((n) => [n.id, n]));
  for (const { id, data: d } of nodes) {
    if (d.kind === 'asset') lines.push(`node ${id} [asset] "${shortText(d.title, 60)}" asset:${d.assetId ?? 'none'}${assetMeta(assets, d.assetId)}`);
    else if (d.kind === 'text') lines.push(`node ${id} [text] "${shortText(d.title, 60)}": ${shortText(d.text, 120)}`);
    else if (d.kind === 'part') lines.push(`node ${id} [${d.partKind}] "${shortText(d.title, 60)}"${d.color ? ` ${d.color}` : ''}${d.groupId ? ` group:${d.groupId}` : ''}${d.styleType ? ` ${d.styleType}` : ''}${dep.pieceTokens[id]?.length ? ` tokens:${dep.pieceTokens[id].join(',')}` : ''}`);
  }
  for (const gr of subject.graph?.groups ?? []) lines.push(`group ${gr.id} "${shortText(gr.title, 60)}" (${gr.nodeIds.length} nodes)`);
  for (const e of subject.graph?.edges ?? []) lines.push(`link: ${shortText(byNode.get(e.source)?.data.title ?? e.source, 40)} -> ${shortText(byNode.get(e.target)?.data.title ?? e.target, 40)}${e.label ? ` [${shortText(e.label, 40)}]` : ''}`);
  for (const kid of dep.kitIds) lines.push(`contains: ${kid} "${shortText(byId.get(kid)?.name ?? kid, 60)}" (${byId.get(kid)?.kind ?? 'item'})`);
  for (const u of usedBy) lines.push(`usedBy: ${u.id} "${shortText(u.name, 60)}" (${u.kind ?? 'item'})`);
  const missing = [...dep.missingKitIds.map((id) => `kit:${id}`), ...dep.missingGroupIds.map((id) => `group:${id}`), ...dep.missingTokenIds.map((id) => `token:${id}`), ...dep.assetIds.filter((id) => !assets[id]).map((id) => `asset:${id}`)];
  if (missing.length) lines.push(`missing: ${missing.join(', ')}`);
  // Last: a long layer list must not push declared relations out of the cap.
  for (const l of doc?.layers ?? []) lines.push(`layer ${l.id} [${l.type}] "${shortText(l.name, 60)}"${l.groupId ? ` in ${l.groupId}` : ''}`);

  const out: string[] = [];
  for (let i = 0, len = 0; i < lines.length; i++) {
    const line = lines[i], sep = out.length ? 1 : 0, rem = lines.length - i, cut = `[truncated: ${rem} more line(s)]`;
    if (len + sep + line.length + (rem > 1 ? cut.length + 1 : 0) > maxChars) {
      return { text: out.length ? `${out.join('\n')}\n${cut}` : `${line.slice(0, Math.max(0, maxChars - cut.length - 1))}\n${cut}`.slice(0, maxChars), truncated: true };
    }
    out.push(line); len += sep + line.length;
  }
  return { text: out.join('\n'), truncated: false };
}

/** Agent context lines for Library: mentionable @Name subjects plus total kit count only. */
export function libraryContextLines(library: readonly Subject[], _assets?: Record<string, unknown>): string[] {
  const out: string[] = [], named = mentionableSubjects(library).filter((s) => !s.capture || s.frontalAssetId);
  if (named.length) out.push(`library (mention as @Name; the app sends its image): ${named.map((s) => `@${s.name} (${s.kind ?? 'character'})${s.description ? ` — ${s.description}` : ''}`).join(', ')}`);
  const kits = library.filter(isKit);
  if (kits.length) out.push(`library items: ${kits.length} (use library.item.list and library.item.read to inspect)`);
  return out;
}
