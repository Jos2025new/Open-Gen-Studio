import { useStore } from '../store/store';
import { fontById, showFonts, storeFonts, withFonts } from './fontFiles';
import type { KitActor, KitFont, KitTokens } from './libraryTypes';
import { saveItem } from './libraryVersions';

/* The user's own fonts: files kept with a Library entry, usable in the Designer and in its exports. */

const first = (v: unknown) => String(v).split(',')[0].trim();

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
  const families = [...new Set(fonts.map((f) => f.family))];
  const tokens = (prev: KitTokens) => {
    const next: KitTokens = { ...prev };
    for (const family of families) {
      if (Object.values(next).some((t) => t.type === 'fontFamily' && first(t.value) === family)) continue;
      let n = 1;
      while (next[`font.${n}`]) n++;
      next[`font.${n}`] = { type: 'fontFamily', value: family };
    }
    return next;
  };
  await saveItem({ subjectId, mode: 'overwrite', space: 'library', by, tokens, fonts: (prev) => withFonts(prev, fonts) });
  showFonts();
  return families;
}

/** The fonts with these ids; throws for one that does not exist. */
export const fontsOf = (ids: readonly string[]): KitFont[] => ids.map((id) => {
  const f = fontById(id);
  if (!f) throw new Error(`No font "${id}".`);
  return f;
});

/** Removes a family's files from the entry, and the token its upload made when no other token points to it; Versions brings both back. */
export async function removeFont(subjectId: string, family: string): Promise<void> {
  const tokens = (prev: KitTokens) => Object.fromEntries(Object.entries(prev).filter(([name, t]) =>
    !(/^font\.\d+$/.test(name) && t.type === 'fontFamily' && first(t.value) === family && !Object.values(prev).some((o) => [o.value, ...Object.values(o.modes ?? {})].some((v) => v === `{${name}}`)))));
  await saveItem({ subjectId, mode: 'overwrite', space: 'library', by: 'user', tokens, fonts: (prev) => prev.filter((f) => f.family !== family) });
  showFonts();
}
