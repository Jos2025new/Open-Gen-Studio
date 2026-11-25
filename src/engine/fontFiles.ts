import { blobDb } from '../lib/idb';
import { useStore } from '../store/store';
import { loadBundledFont } from './design/exportFontFiles';
import type { KitFont } from './libraryTypes';

/* The bytes of the Library's font files, for the page and for exports. */
export const fontKey = (id: string) => `font:${id}`;
const bytesOf = new Map<string, Promise<Uint8Array | null>>();
const shown = new Set<string>();

const bytes = (id: string): Promise<Uint8Array | null> => {
  let p = bytesOf.get(id);
  if (!p) {
    p = blobDb.get(fontKey(id)).then(async (b) => (b ? new Uint8Array(await b.arrayBuffer()) : null)).catch(() => null);
    bytesOf.set(id, p);
    // A file that is not there yet (the disk copy still loading) is asked for again next time.
    void p.then((b) => { if (!b) bytesOf.delete(id); });
  }
  return p;
};
export const face = (f: KitFont, data: Uint8Array) => new FontFace(f.family, data.slice().buffer, { weight: f.variable ? '1 1000' : String(f.weight), style: f.italic ? 'italic' : 'normal' });

/** Makes the Library's font files available to the page; text that waited for one redraws by itself (a face made from bytes does not announce itself). */
export function showFonts(): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  for (const s of useStore.getState().library) for (const f of s.fonts ?? []) {
    if (shown.has(f.id)) continue;
    shown.add(f.id);
    void bytes(f.id).then(async (data) => { if (!data) { shown.delete(f.id); return; } const one = face(f, data); await one.load(); document.fonts.add(one); document.fonts.dispatchEvent(new Event('loadingdone')); }).catch(() => undefined);
  }
}

export function installOwnFonts(): () => void {
  showFonts();
  return useStore.subscribe((st, prev) => { if (st.library !== prev.library) showFonts(); });
}

/** The file of a font for exports: the user's nearest weight, else one the app ships; null when there is none. */
export async function loadFontFile(family: string, weight: number): Promise<Uint8Array | null> {
  const own = useStore.getState().library.flatMap((s) => s.fonts ?? []).filter((f) => f.family === family && !f.italic).sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
  return (own && (await bytes(own.id))) ?? loadBundledFont(family, weight);
}
