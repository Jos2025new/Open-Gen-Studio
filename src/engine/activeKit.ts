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
/** The document of each saved version read so far; a version never changes. */
const docs = new Map<string, DesignDoc | undefined>();

export const activeKit = (st = get()): Subject | undefined => (st.composer.kitId ? st.library.find((s) => s.id === st.composer.kitId && isKit(s)) : undefined);

/** The picked entry and the ones it contains. */
function activeKitItems(st = get()): Subject[] {
  const kit = activeKit(st);
  if (!kit) return [];
  const out = [kit];
  for (const s of out) for (const id of kitDependencies(s, st.library).kitIds) { const inside = st.library.find((x) => x.id === id); if (inside && !out.includes(inside)) out.push(inside); }
  return out;
}

/** Reads the documents of the picked entries, so the agent also gets their colors, fonts and components. */
export async function loadActiveKit(): Promise<void> {
  for (const { versionId } of activeKitItems()) {
    if (!versionId || docs.has(versionId)) continue;
    const snap = await readKitVersion(versionId).catch(() => null);
    if (docs.size > 40) docs.clear();
    if (snap) docs.set(versionId, snap.doc);
  }
}

export function activeKitImages(st = get()): string[] {
  const kits = activeKitItems(st);
  const logos = kits.flatMap((s) => (s.graph?.nodes ?? []).flatMap((n) => (n.data.kind === 'asset' && n.data.section === 'Logos' && n.data.assetId && st.assets[n.data.assetId]?.kind === 'image' ? [n.data.assetId] : [])));
  return [...new Set([...logos, ...kits.flatMap((s) => kitImageAssetIds(s, st.assets))])].slice(0, MAX_IMAGES);
}

export function activeKitLines(st = get()): string[] {
  const [kit, ...inside] = activeKitItems(st);
  if (!kit) return [];
  const index = (s: Subject, max: number) => formatLibraryItemIndex(s, st.library, st.assets, max, s.versionId ? docs.get(s.versionId) : undefined).text;
  const images = activeKitImages(st);
  return [
    `active ${kit.kind!.replace('-', ' ')} (picked by the user; every piece follows it):\n${index(kit, 2500)}`,
    ...inside.map((s) => `inside it:\n${index(s, 1200)}`),
    ...(images.length ? [`its images (usable as refs): ${images.map((id) => `asset:${id}`).join(', ')}`] : []),
  ];
}

/** Its colors: color tokens and color elements, as hex. */
export function activeKitColors(st = get()): string[] {
  const hex = /^#[0-9a-f]{6}$/i;
  return [...new Set(activeKitItems(st).flatMap((s) => [
    ...Object.entries(s.tokens ?? {}).flatMap(([name, t]) => (t.type === 'color' ? [String(resolveToken(s.tokens!, name) ?? '')] : [])),
    ...(s.graph?.nodes ?? []).flatMap((n) => (n.data.kind === 'part' && n.data.color ? [n.data.color] : [])),
  ]).filter((c) => hex.test(c)).map((c) => c.toLowerCase()))].slice(0, 32);
}

/** What the agent reads about the Library in each request. */
export const libraryLines = (st = get()): string[] => [...libraryContextLines(st.library, st.assets), ...activeKitLines(st)];
