import { uid } from '../lib/id';
import { blobDb } from '../lib/idb';
import { useStore } from '../store/store';
import { loadBundledFont } from './design/exportFontFiles';
import { fontInfo } from './design/exportText';
import { isWoff2, woff2ToSfnt } from './design/woff2';
import { withCleanup, writeVerified } from './librarySnapshot';
import type { KitFont } from './libraryTypes';

/* The user's font files (of Library entries and of sessions), for the page and for exports. */
const MAX_BYTES = 12 * 1024 * 1024;
export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';
export const isFontFile = (f: { name: string }) => /\.(ttf|otf|woff2?)$/i.test(f.name);
const fontKey = (id: string) => `font:${id}`;
const bytesOf = new Map<string, Promise<Uint8Array | null>>();
/** The fonts the page has; null while one loads. */
const shown = new Map<string, FontFace | null>();

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

async function unbrotli(packed: Uint8Array): Promise<Uint8Array> {
  const res = await fetch('/x/store/unbrotli', { method: 'POST', headers: { 'X-OGS': '1', 'Content-Type': 'application/octet-stream' }, body: packed.slice() });
  if (!res.ok) throw new Error('Could not unpack the font.');
  return new Uint8Array(await res.arrayBuffer());
}

/** Reads and stores font files; all of them or none. */
export async function storeFonts(files: readonly File[]): Promise<KitFont[]> {
  const ready: Array<{ font: KitFont; data: Uint8Array; type: string }> = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) throw new Error(`"${file.name}" is larger than 12 MB.`);
    let data = new Uint8Array(await file.arrayBuffer());
    // Kept as TTF/OTF: exports read its outlines.
    const packed = isWoff2(data);
    if (packed) data = new Uint8Array(await woff2ToSfnt(data, unbrotli).catch(() => { throw new Error(`"${file.name}" could not be read as a font.`); }));
    const info = fontInfo(data);
    if (!info) throw new Error(`"${file.name}" is not a TTF, OTF or WOFF font.`);
    const font: KitFont = { id: uid('font'), ...info, name: file.name };
    await face(font, data).load().catch(() => { throw new Error(`"${file.name}" could not be read as a font.`); });
    ready.push({ font, data, type: packed ? 'font/ttf' : file.type || 'font/ttf' });
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

const sameFace = (a: KitFont, b: KitFont) => a.family === b.family && a.weight === b.weight && Boolean(a.italic) === Boolean(b.italic);
/** A list of fonts with others added; the same face is replaced. */
export const withFonts = (old: readonly KitFont[] | undefined, add: readonly KitFont[]): KitFont[] => [...(old ?? []).filter((f) => !add.some((r) => sameFace(r, f))), ...add];

/** Fonts in Library on their own, one entry per family. */
export function keepInLibrary(fonts: readonly KitFont[]): void {
  useStore.setState((st) => {
    let library = st.library;
    for (const family of new Set(fonts.map((f) => f.family))) {
      const add = fonts.filter((f) => f.family === family), old = library.find((s) => s.kind === 'font' && s.name === family);
      library = old ? library.map((s) => (s === old ? { ...s, fonts: withFonts(s.fonts, add) } : s)) : [...library, { id: uid('sub'), name: family, kind: 'font', refAssetIds: [], fonts: add }];
    }
    return { library };
  });
}

/** Keeps the page's fonts equal to the user's; text that waited for one redraws by itself (a face made from bytes does not announce itself). */
export function showFonts(): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
  const fonts = allFonts(), ids = new Set(fonts.map((f) => f.id)), told = () => document.fonts.dispatchEvent(new Event('loadingdone'));
  for (const [id, one] of shown) if (!ids.has(id)) { shown.delete(id); if (one && document.fonts.delete(one)) told(); }
  for (const f of fonts) {
    if (shown.has(f.id)) continue;
    shown.set(f.id, null);
    void bytes(f.id).then(async (data) => {
      const one = data && face(f, data);
      await one?.load();
      if (!one || !shown.has(f.id)) { shown.delete(f.id); return; }
      shown.set(f.id, one); document.fonts.add(one); told();
    }).catch(() => undefined);
  }
}

export function installOwnFonts(): () => void {
  showFonts();
  return useStore.subscribe((st, prev) => { if (st.library !== prev.library || st.activeSessionId !== prev.activeSessionId) showFonts(); });
}

/** The file of a font for exports: the user's, of that slant and the nearest weight, else one the app ships; null when there is none. */
export async function loadFontFile(family: string, weight: number, italic = false): Promise<Uint8Array | null> {
  const off = (f: KitFont) => Number((f.italic ?? false) !== italic);
  const own = allFonts().filter((f) => f.family === family).sort((a, b) => off(a) - off(b) || Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
  return (own && (await bytes(own.id))) ?? loadBundledFont(family, weight);
}
