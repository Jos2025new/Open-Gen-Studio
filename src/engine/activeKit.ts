import { useStore } from '../store/store';
import { kitImageAssetIds } from './flow/fromLibrary';
import { formatLibraryItemIndex, kitDependencies, libraryContextLines } from './libraryGraph';
import { resolveToken } from './libraryTokens';
import { isKit } from './libraryTypes';
import { readKitVersion } from './libraryVersions';
import type { DesignDoc, Subject } from './types';

/* The moodboard, design system or brand kit the user picked to work with: what the agent and the color picker get from it. */
const get = () => useStore.getState();
const MAX_IMAGES = 6;
const MAX_INSIDE = 4800;
/** The document of each saved version read so far; a version never changes. */
const docs = new Map<string, DesignDoc | undefined>();

export const activeKit = (st = get()): Subject | undefined => (st.composer.kitId ? st.library.find((s) => s.id === st.composer.kitId && isKit(s)) : undefined);

/** The picked entry and the ones it contains; then, the entry the document on screen belongs to (`own`) with the ones it contains. */
export function activeKitItems(st = get(), own?: string): Subject[] {
  const out = [activeKit(st), own ? st.library.find((s) => s.id === own && isKit(s)) : undefined].filter((s): s is Subject => Boolean(s));
  if (out[0] === out[1]) out.pop();
  for (const s of out) for (const id of kitDependencies(s, st.library).kitIds) { const inside = st.library.find((x) => x.id === id); if (inside && !out.includes(inside)) out.push(inside); }
  return out;
}

/** Reads the documents of the picked entries, so the agent also gets their colors, fonts and components. */
export async function loadActiveKit(own?: string): Promise<void> {
  for (const { versionId } of activeKitItems(get(), own)) {
    if (!versionId || docs.has(versionId)) continue;
    const snap = await readKitVersion(versionId).catch(() => null);
    if (docs.size > 40) docs.clear();
    if (snap) docs.set(versionId, snap.doc);
  }
}

/** Keeps them read as the picked entry, the Library or the document on screen changes: the agent's later requests of a turn see the same as the first. */
export function installActiveKit(): () => void {
  const own = (st = get()) => { const s = st.sessions[st.activeSessionId]; return s?.docs.find((d) => d.id === s.activeDocId)?.library?.subjectId; };
  void loadActiveKit(own());
  return useStore.subscribe((st, prev) => { if (st.library !== prev.library || st.composer.kitId !== prev.composer.kitId || own(st) !== own(prev)) void loadActiveKit(own(st)); });
}

export function activeKitImages(st = get()): string[] {
  const kits = activeKitItems(st);
  const logos = kits.flatMap((s) => (s.graph?.nodes ?? []).flatMap((n) => (n.data.kind === 'asset' && n.data.section === 'Logos' && n.data.assetId && st.assets[n.data.assetId]?.kind === 'image' ? [n.data.assetId] : [])));
  return [...new Set([...logos, ...kits.flatMap((s) => kitImageAssetIds(s, st.assets))])].slice(0, MAX_IMAGES);
}

export function activeKitLines(st = get(), own?: string): string[] {
  const picked = activeKit(st), [kit, ...inside] = activeKitItems(st, own);
  if (!kit) return [];
  const index = (s: Subject, max: number) => formatLibraryItemIndex(s, st.library, st.assets, max, s.versionId ? docs.get(s.versionId) : undefined).text;
  const images = picked ? activeKitImages(st) : [];
  // One total for what it contains: each entry is paid again in every request.
  let room = MAX_INSIDE;
  const kept: string[] = [], rest: Subject[] = [];
  for (const s of inside) {
    const text = room > 200 ? index(s, Math.min(1200, room)) : '';
    if (text) { kept.push(`${s.id === own ? 'the document on screen is of' : 'inside it'}:\n${text}`); room -= text.length; } else rest.push(s);
  }
  return [
    `${picked ? `active ${kit.kind!.replace('-', ' ')} (picked by the user; every piece follows it)` : `the document on screen is of this ${kit.kind!.replace('-', ' ')}`}:\n${index(kit, 2500)}`,
    ...(Object.keys(kit.tokens ?? {}).length || inside.some((s) => s.tokens) ? ['in Designer text and shapes write a token as "{its.name}" for color, fill, stroke, fontFamily, fontSize or a page background: the design then follows the token.'] : []),
    ...kept,
    ...(rest.length ? [`also inside it (library.item.read to inspect): ${rest.slice(0, 20).map((s) => `${s.id} ${JSON.stringify(s.name)}`).join(', ')}${rest.length > 20 ? ` and ${rest.length - 20} more` : ''}`] : []),
    ...(images.length ? [`its images (usable as refs): ${images.map((id) => `asset:${id}`).join(', ')}`] : []),
  ];
}

/** The colors of an entry: color tokens and color elements, as hex. */
export const kitColors = (s: Subject): string[] => [...new Set([
  ...Object.entries(s.tokens ?? {}).flatMap(([name, t]) => (t.type === 'color' ? [String(resolveToken(s.tokens!, name) ?? '')] : [])),
  ...(s.graph?.nodes ?? []).flatMap((n) => (n.data.kind === 'part' && n.data.color ? [n.data.color] : [])),
].filter((c) => /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase()))];
/** The colors of the picked entry and the ones it contains. */
export const activeKitColors = (st = get()): string[] => [...new Set(activeKitItems(st).flatMap(kitColors))].slice(0, 32);

/** What the agent reads about the Library in each request. */
export const libraryLines = (st = get(), own?: string): string[] => [...libraryContextLines(st.library, st.assets), ...activeKitLines(st, own)];
