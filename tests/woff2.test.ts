import { readFileSync } from 'node:fs';
// @ts-expect-error Node's types are not installed in this browser project.
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { canEmbedInPdf, fontInfo, woffToSfnt } from '../src/engine/design/exportText';
import { isWoff2, woff2ToSfnt } from '../src/engine/design/woff2';
import { handleUnbrotli } from '../server/brotli.js';

const file = (name: string) => new Uint8Array(readFileSync(`node_modules/${name}`));
const bytes = (s: string) => new TextEncoder().encode(s);
const unpack = (b: Uint8Array) => woff2ToSfnt(b, async (x) => new Uint8Array(brotliDecompressSync(x) as Uint8Array));
interface Opened { unitsPerEm: number; charToGlyph(c: string): { advanceWidth?: number; getBoundingBox(): { x1: number; y1: number; x2: number; y2: number } } }
const open = (sfnt: Uint8Array) => parse(woffToSfnt(sfnt, ['GSUB']).slice().buffer as ArrayBuffer) as unknown as Opened;

describe('WOFF2', () => {
  it.each(['inter', 'outfit', 'dm-sans'])('%s keeps its letters, measures and names', async (family) => {
    const base = `@fontsource/${family}/files/${family}-latin-700-normal`;
    const a = open(woffToSfnt(file(`${base}.woff`))), sfnt = await unpack(file(`${base}.woff2`)), b = open(sfnt);
    expect(fontInfo(sfnt)).toMatchObject({ weight: 700 });
    expect(canEmbedInPdf(sfnt)).toBe(true);
    // Both files are builds of the same drawing, made apart: a unit of rounding is all they may differ in.
    const box = (f: Opened, c: string) => { const g = f.charToGlyph(c), k = 1000 / f.unitsPerEm, r = g.getBoundingBox(); return [r.x1, r.y1, r.x2, r.y2, g.advanceWidth ?? 0].map((n) => n * k); };
    for (const c of 'ABCQRSaegkoqsxyz019&@?') box(a, c).forEach((n, i) => expect(Math.abs(n - box(b, c)[i]), `${c} ${i}`).toBeLessThan(2));
  });

  it('a variable one keeps its axis', async () => {
    const sfnt = await unpack(file('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'));
    expect(fontInfo(sfnt)).toMatchObject({ variable: true });
  });

  it('a broken file is refused, never half read', async () => {
    const good = file('@fontsource/inter/files/inter-latin-700-normal.woff2');
    expect(isWoff2(good)).toBe(true);
    for (const cut of [10, 47, 60, good.length >> 1]) await expect(unpack(good.slice(0, cut))).rejects.toThrow();
    const collection = good.slice();
    collection.set([0x74, 0x74, 0x63, 0x66], 4);
    await expect(unpack(collection)).rejects.toThrow('collection');
  });

  it('the server unpacks with a limit', async () => {
    const r = await handleUnbrotli(brotliCompressSync(bytes('hello')));
    expect([r.status, new TextDecoder().decode(r.body as Uint8Array)]).toEqual([200, 'hello']);
    expect(await handleUnbrotli(bytes('nope, not brotli'))).toMatchObject({ status: 400 });
    expect(await handleUnbrotli(brotliCompressSync(new Uint8Array(5000)), 1000)).toMatchObject({ status: 400 });
    expect(await handleUnbrotli(new Uint8Array(12 * 1024 * 1024 + 1))).toMatchObject({ status: 413 });
  });
});
