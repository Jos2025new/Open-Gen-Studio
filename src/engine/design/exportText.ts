import { unzlibSync } from 'fflate';
import { buildSfnt } from './sfnt';
import type { TextLayer } from '../types';
import type { Font } from 'opentype.js';

export type FontLoader = (family: string, weight: number, italic?: boolean) => Promise<Uint8Array | null>;
export interface LoadedFont { family: string; weight: number; italic?: boolean; woff: Uint8Array }
/** Asked for in italic, and the file has none: the page slants it. */
export const isSlanted = (italic: boolean | undefined, file: Uint8Array) => Boolean(italic) && !fontInfo(file)?.italic;

const kindOf = (b: Uint8Array): 'woff' | 'ttf' | 'otf' | null => {
  const tag = String.fromCharCode(...b.subarray(0, 4));
  return tag === 'wOFF' ? 'woff' : tag === 'OTTO' ? 'otf' : tag === 'true' || tag === '\0\x01\0\0' ? 'ttf' : null;
};
const uncompressed = (v: DataView, b: Uint8Array) => Array.from({ length: v.getUint16(4) }, (_, i) => {
  const o = 12 + i * 16, at = v.getUint32(o + 8);
  return { tag: b.subarray(o, o + 4), data: b.subarray(at, at + v.getUint32(o + 12)), sum: v.getUint32(o + 4) };
});
const tagsOf = (sfnt: Uint8Array) => uncompressed(new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength), sfnt).map((t) => ({ tag: String.fromCharCode(...t.tag), data: t.data }));

/** The outlines of the file are those of one weight: a variable font's are not (only the page can shape it). */
export const canOutline = (font: Uint8Array): boolean => !tagsOf(woffToSfnt(font)).some((t) => t.tag === 'fvar');
/** A PDF takes TrueType outlines of one weight. */
export const canEmbedInPdf = (font: Uint8Array): boolean => canOutline(font) && tagsOf(woffToSfnt(font)).some((t) => t.tag === 'glyf');

/** Family, weight and style as the file names them; null when it is not a TTF, OTF or WOFF font. */
export function fontInfo(file: Uint8Array): { family: string; weight: number; italic?: boolean; variable?: boolean } | null {
  try {
    if (!kindOf(file)) return null;
    const tables = tagsOf(woffToSfnt(file)), table = (t: string) => { const d = tables.find((x) => x.tag === t)?.data; return d && new DataView(d.buffer, d.byteOffset, d.byteLength); };
    const name = table('name'), os2 = table('OS/2'), names = new Map<number, string>();
    if (!name) return null;
    for (let i = 0, at = name.getUint16(4); i < name.getUint16(2); i++) {
      const o = 6 + i * 12, platform = name.getUint16(o), id = name.getUint16(o + 6), start = at + name.getUint16(o + 10), length = name.getUint16(o + 8);
      if ((id !== 1 && id !== 16) || (names.has(id) && !(platform === 3 && name.getUint16(o + 4) === 0x409))) continue;
      const raw = Array.from({ length: platform === 1 ? length : length >> 1 }, (_, k) => (platform === 1 ? name.getUint8(start + k) : name.getUint16(start + k * 2)));
      names.set(id, String.fromCharCode(...raw).trim());
    }
    const family = (names.get(16) ?? names.get(1) ?? '').replace(/['"\\<>;{},]/g, '').trim();
    if (!family) return null;
    return { family, weight: Math.min(1000, Math.max(1, os2?.getUint16(4) || 400)), ...(os2 && os2.byteLength > 63 && os2.getUint16(62) & 1 ? { italic: true } : {}), ...(table('fvar') ? { variable: true } : {}) };
  } catch { return null; }
}

/** WOFF 1 → plain sfnt (TrueType/OpenType), which jsPDF and opentype.js read directly; a TTF or OTF stays as it is. */
export function woffToSfnt(woff: Uint8Array, drop: string[] = []): Uint8Array {
  const packed = kindOf(woff) === 'woff';
  if (!packed && !drop.length) return woff;
  const v = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  const all = !packed ? uncompressed(v, woff) : Array.from({ length: v.getUint16(12) }, (_, i) => {
    const o = 44 + i * 20, offset = v.getUint32(o + 4), compressed = v.getUint32(o + 8), original = v.getUint32(o + 12);
    const raw = woff.subarray(offset, offset + compressed);
    return { tag: woff.subarray(o, o + 4), data: compressed < original ? unzlibSync(raw) : raw, sum: v.getUint32(o + 16) };
  });
  const tables = all.filter((t) => !drop.includes(String.fromCharCode(...t.tag)));
  return buildSfnt(v.getUint32(packed ? 4 : 0), tables);
}

export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const parsed = new WeakMap<Uint8Array, Font>();
async function parseFont(woff: Uint8Array): Promise<Font> {
  let font = parsed.get(woff);
  if (!font) {
    const { parse } = await import('opentype.js');
    // opentype.js cannot read every GSUB lookup (ligatures are not needed for outlines); kerning stays.
    const sfnt = woffToSfnt(woff, ['GSUB']);
    font = parse(sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength) as ArrayBuffer);
    parsed.set(woff, font);
  }
  return font;
}

/** Fonts the visible text layers use, with the files the app has and the families it cannot read. */
export async function collectFonts(layers: TextLayer[], load?: FontLoader) {
  const found = new Map<string, LoadedFont>(), missing = new Set<string>();
  for (const l of layers) {
    const key = `${l.fontFamily}|${l.fontWeight}${l.italic ? '|italic' : ''}`;
    if (found.has(key)) continue;
    const woff = await load?.(l.fontFamily, l.fontWeight, l.italic);
    if (woff) found.set(key, { family: l.fontFamily, weight: l.fontWeight, ...(l.italic ? { italic: true } : {}), woff });
    else missing.add(l.fontFamily);
  }
  return { found, missing: [...missing] };
}

/** Embedded @font-face rules (base64 WOFF), one per family and weight used. */
export function fontFaceCss(fonts: Iterable<LoadedFont>): string {
  return [...fonts].map((f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};${f.italic && !isSlanted(true, f.woff) ? 'font-style:italic;' : ''}src:url(data:font/${kindOf(f.woff) ?? 'woff'};base64,${base64(f.woff)}) format('${{ woff: 'woff', ttf: 'truetype', otf: 'opentype' }[kindOf(f.woff) ?? 'woff']}')}`).join('');
}

/** Path data for each line of a laid-out text, placed exactly where the live text would be. */
export async function textPathData(woff: Uint8Array, l: TextLayer, t: { lines: string[]; width: number; lineHeightPx: number }, ascent: number): Promise<string[]> {
  const font = await parseFont(woff);
  const options = { kerning: true, letterSpacing: l.letterSpacing ? l.letterSpacing / l.fontSize : 0 };
  const pad = (t.lineHeightPx - l.fontSize) / 2, slanted = isSlanted(l.italic, woff);
  const edge = l.align === 'center' ? l.x + t.width / 2 : l.align === 'right' ? l.x + t.width : l.x;
  return t.lines.map((line, i) => {
    const w = font.getAdvanceWidth(line, l.fontSize, options);
    const x = l.align === 'center' ? edge - w / 2 : l.align === 'right' ? edge - w : edge;
    const base = l.y + i * t.lineHeightPx + pad + ascent, path = font.getPath(line, x, base, l.fontSize, options);
    // The slant the browser gives a font without italics.
    if (slanted) for (const c of path.commands) for (const k of ['', '1', '2']) if (`x${k}` in c) c[`x${k}`] += (base - c[`y${k}`]) / 4;
    return path.toPathData(3);
  }).filter(Boolean);
}
