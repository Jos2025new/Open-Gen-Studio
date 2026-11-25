import { uid } from '../lib/id';
import { blobDb } from '../lib/idb';
import { useStore } from '../store/store';
import { loadBundledFont } from './design/exportFontFiles';
import { fontInfo } from './design/exportText';
import { withCleanup, writeVerified } from './librarySnapshot';
import type { KitFont } from './libraryTypes';

/* The user's font files (of Library entries and of sessions), for the page and for exports. */
const MAX_BYTES = 12 * 1024 * 1024;
export const FONT_ACCEPT = '.ttf,.otf,.woff,font/ttf,font/otf,font/woff';
export const isFontFile = (f: { name: string }) => /\.(ttf|otf|woff2?)$/i.test(f.name);
const fontKey = (id: string) => `font:${id}`;
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
const face = (f: KitFont, data: Uint8Array) => new FontFace(f.family, data.slice().buffer, { weight: f.variable ? '1 1000' : String(f.weight), style: f.italic ? 'italic' : 'normal' });

type St = ReturnType<typeof useStore.getState>;
const allFonts = (st: St = useStore.getState()): KitFont[] => [...st.library.flatMap((s) => s.fonts ?? []), ...Object.values(st.sessions).flatMap((s) => s.fonts ?? [])];
export const fontById = (id: string, st?: St): KitFont | undefined => (id.startsWith('font_') ? allFonts(st).find((f) => f.id === id) : undefined);

/** A font as the agent reads it. */
export const fontLine = (f: KitFont): string => `${f.id} fontFamily=${JSON.stringify(f.family)} (${f.variable ? 'any weight' : `weight ${f.weight}`}${f.italic ? ', italic' : ''})`;

/** Reads and stores font files; all of them or none. */
export async function storeFonts(files: readonly File[]): Promise<KitFont[]> {
  const ready: Array<{ font: KitFont; data: Uint8Array; type: string }> = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) throw new Error(`"${file.name}" is larger than 12 MB.`);
    const data = new Uint8Array(await file.arrayBuffer()), info = fontInfo(data);
    if (!info) throw new Error(`"${file.name}" is not a TTF, OTF or WOFF font.`);
    const font: KitFont = { id: uid('font'), ...info, name: file.name };
    await face(font, data).load().catch(() => { throw new Error(`"${file.name}" could not be read as a font.`); });
    ready.push({ font, data, type: file.type || 'font/ttf' });
  }
  return withCleanup(async (written) => {
    for (const r of ready) await writeVerified(fontKey(r.font.id), new Blob([r.data.slice()], { type: r.type }), r.data, written);
    return ready.map((r) => r.font);
  });
}

/** Fonts given in a session (attached to a message): usable in its designs without being in Library. */
export function keepInSession(sessionId: string, fonts: readonly KitFont[]): void {
  useStore.setState((st) => {
    const s = st.sessions[sessionId], add = fonts.filter((f) => !s?.fonts?.some((x) => x.id === f.id));
    return s && add.length ? { sessions: { ...st.sessions, [sessionId]: { ...s, fonts: [...(s.fonts ?? []), ...add] } } } : st;
  });
  showFonts();
}

/** Makes the Library's font files available to the page; text that waited for one redraws by itself (a face made from bytes does not announce itself). */
export function showFonts(): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  for (const f of allFonts()) {
    if (shown.has(f.id)) continue;
    shown.add(f.id);
    void bytes(f.id).then(async (data) => { if (!data) { shown.delete(f.id); return; } const one = face(f, data); await one.load(); document.fonts.add(one); document.fonts.dispatchEvent(new Event('loadingdone')); }).catch(() => undefined);
  }
}

export function installOwnFonts(): () => void {
  showFonts();
  return useStore.subscribe((st, prev) => { if (st.library !== prev.library || st.activeSessionId !== prev.activeSessionId) showFonts(); });
}

/** The file of a font for exports: the user's nearest weight, else one the app ships; null when there is none. */
export async function loadFontFile(family: string, weight: number): Promise<Uint8Array | null> {
  const own = allFonts().filter((f) => f.family === family).sort((a, b) => Number(a.italic ?? false) - Number(b.italic ?? false) || Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
  return (own && (await bytes(own.id))) ?? loadBundledFont(family, weight);
}
