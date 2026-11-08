import { unzlibSync } from 'fflate';
import type { TextLayer } from '../types';
import type { Font } from 'opentype.js';

export type FontLoader = (family: string, weight: number) => Promise<Uint8Array | null>;
export interface LoadedFont { family: string; weight: number; woff: Uint8Array }

/** WOFF 1 → plain sfnt (TrueType/OpenType), which jsPDF and opentype.js read directly. */
export function woffToSfnt(woff: Uint8Array, drop: string[] = []): Uint8Array {
  const v = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  const all = Array.from({ length: v.getUint16(12) }, (_, i) => {
    const o = 44 + i * 20, offset = v.getUint32(o + 4), compressed = v.getUint32(o + 8), original = v.getUint32(o + 12);
    const raw = woff.subarray(offset, offset + compressed);
    return { tag: woff.subarray(o, o + 4), data: compressed < original ? unzlibSync(raw) : raw, sum: v.getUint32(o + 16) };
  });
  const tables = all.filter((t) => !drop.includes(String.fromCharCode(...t.tag)));
  const count = tables.length;
  const head = 12 + count * 16;
  const out = new Uint8Array(tables.reduce((size, t) => size + ((t.data.length + 3) & ~3), head));
  const dv = new DataView(out.buffer);
  dv.setUint32(0, v.getUint32(4));
  dv.setUint16(4, count);
  const pow = 2 ** Math.floor(Math.log2(count));
  dv.setUint16(6, pow * 16); dv.setUint16(8, Math.log2(pow)); dv.setUint16(10, count * 16 - pow * 16);
  let at = head;
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    out.set(t.tag, o); dv.setUint32(o + 4, t.sum); dv.setUint32(o + 8, at); dv.setUint32(o + 12, t.data.length);
    out.set(t.data, at);
    at += (t.data.length + 3) & ~3;
  });
  return out;
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
    const key = `${l.fontFamily}|${l.fontWeight}`;
    if (found.has(key)) continue;
    const woff = await load?.(l.fontFamily, l.fontWeight);
    if (woff) found.set(key, { family: l.fontFamily, weight: l.fontWeight, woff });
    else missing.add(l.fontFamily);
  }
  return { found, missing: [...missing] };
}

/** Embedded @font-face rules (base64 WOFF), one per family and weight used. */
export function fontFaceCss(fonts: Iterable<LoadedFont>): string {
  return [...fonts].map((f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};src:url(data:font/woff;base64,${base64(f.woff)}) format('woff')}`).join('');
}

/** Path data for each line of a laid-out text, placed exactly where the live text would be. */
export async function textPathData(woff: Uint8Array, l: TextLayer, t: { lines: string[]; width: number; lineHeightPx: number }, ascent: number): Promise<string[]> {
  const font = await parseFont(woff);
  const options = { kerning: true, letterSpacing: l.letterSpacing ? l.letterSpacing / l.fontSize : 0 };
  const pad = (t.lineHeightPx - l.fontSize) / 2;
  const edge = l.align === 'center' ? l.x + t.width / 2 : l.align === 'right' ? l.x + t.width : l.x;
  return t.lines.map((line, i) => {
    const w = font.getAdvanceWidth(line, l.fontSize, options);
    const x = l.align === 'center' ? edge - w / 2 : l.align === 'right' ? edge - w : edge;
    return font.getPath(line, x, l.y + i * t.lineHeightPx + pad + ascent, l.fontSize, options).toPathData(3);
  }).filter(Boolean);
}
