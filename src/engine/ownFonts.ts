import { useStore } from '../store/store';
import { fontById, showFonts, storeFonts, withFonts } from './fontFiles';
import type { KitActor, KitFont, KitTokens } from './libraryTypes';
import { saveItem } from './libraryVersions';

/* The user's own fonts: files kept with a Library entry, usable in the Designer and in its exports. */

/** Adds font files to an entry: their family becomes one of its font tokens. Returns the families added. */
export async function addFonts(subjectId: string, files: readonly File[]): Promise<string[]> {
  return putFonts(subjectId, await storeFonts(files), 'user');
}

/** Adds fonts whose files are already stored (attached to a message, or of another entry). */
export async function putFonts(subjectId: string, fonts: readonly KitFont[], by: KitActor): Promise<string[]> {
  if (!fonts.length) return [];
  const live = useStore.getState().library.find((s) => s.id === subjectId);
  if (!live) throw new Error('The Library entry is gone.');
  if (live.kind !== 'brand-kit' && live.kind !== 'design-system') throw new Error('Fonts go in a brand kit or a design system.');
  const tokens: KitTokens = { ...live.tokens }, families = [...new Set(fonts.map((f) => f.family))];
  for (const family of families) {
    if (Object.values(tokens).some((t) => t.type === 'fontFamily' && String(t.value).split(',')[0].trim() === family)) continue;
    let n = 1;
    while (tokens[`font.${n}`]) n++;
    tokens[`font.${n}`] = { type: 'fontFamily', value: family };
  }
  await saveItem({ subjectId, mode: 'overwrite', space: 'library', by, tokens });
  useStore.setState((st) => ({ library: st.library.map((s) => (s.id === subjectId ? { ...s, fonts: withFonts(s.fonts, fonts) } : s)) }));
  showFonts();
  return families;
}

/** The fonts with these ids; throws for one that does not exist. */
export const fontsOf = (ids: readonly string[]): KitFont[] => ids.map((id) => {
  const f = fontById(id);
  if (!f) throw new Error(`No font "${id}".`);
  return f;
});

/** Removes a family's files from the entry; its versions keep working with the token's name. */
export function removeFont(subjectId: string, family: string): void {
  useStore.setState((st) => ({ library: st.library.map((s) => (s.id === subjectId ? { ...s, fonts: (s.fonts ?? []).filter((f) => f.family !== family) } : s)) }));
}
