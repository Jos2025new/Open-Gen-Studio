import { uid } from '../lib/id';
import { useStore } from '../store/store';
import { fontInfo } from './design/exportText';
import { face, fontKey, showFonts } from './fontFiles';
import { withCleanup, writeVerified } from './librarySnapshot';
import type { KitFont, KitTokens } from './libraryTypes';
import { saveItem } from './libraryVersions';

/* The user's own fonts: files kept with a Library entry, usable in the Designer and in its exports. */
const MAX_BYTES = 12 * 1024 * 1024;
/** Adds font files to an entry: their family becomes one of its font tokens. Returns the families added. */
export async function addFonts(subjectId: string, files: readonly File[]): Promise<string[]> {
  const ready: Array<{ font: KitFont; data: Uint8Array; type: string }> = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) throw new Error(`"${file.name}" is larger than 12 MB.`);
    const data = new Uint8Array(await file.arrayBuffer()), info = fontInfo(data);
    if (!info) throw new Error(`"${file.name}" is not a TTF, OTF or WOFF font.`);
    const font: KitFont = { id: uid('font'), ...info, name: file.name };
    await face(font, data).load().catch(() => { throw new Error(`"${file.name}" could not be read as a font.`); });
    ready.push({ font, data, type: file.type || 'font/ttf' });
  }
  if (!ready.length) return [];
  return withCleanup(async (written) => {
    for (const r of ready) await writeVerified(fontKey(r.font.id), new Blob([r.data.slice()], { type: r.type }), r.data, written);
    const live = useStore.getState().library.find((s) => s.id === subjectId);
    if (!live) throw new Error('The Library entry is gone.');
    const tokens: KitTokens = { ...live.tokens }, families = [...new Set(ready.map((r) => r.font.family))];
    for (const family of families) {
      if (Object.values(tokens).some((t) => t.type === 'fontFamily' && String(t.value).split(',')[0].trim() === family)) continue;
      let n = 1;
      while (tokens[`font.${n}`]) n++;
      tokens[`font.${n}`] = { type: 'fontFamily', value: family };
    }
    const same = (a: KitFont, b: KitFont) => a.family === b.family && a.weight === b.weight && a.italic === b.italic;
    await saveItem({ subjectId, mode: 'overwrite', space: 'library', by: 'user', tokens });
    useStore.setState((st) => ({ library: st.library.map((s) => (s.id === subjectId ? { ...s, fonts: [...(s.fonts ?? []).filter((f) => !ready.some((r) => same(r.font, f))), ...ready.map((r) => r.font)] } : s)) }));
    showFonts();
    return families;
  });
}

/** Removes a family's files from the entry; its versions keep working with the token's name. */
export function removeFont(subjectId: string, family: string): void {
  useStore.setState((st) => ({ library: st.library.map((s) => (s.id === subjectId ? { ...s, fonts: (s.fonts ?? []).filter((f) => f.family !== family) } : s)) }));
}
