import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from './library-kits-final-fixtures';
import { fontNames, fontStack } from '../src/engine/design/doc';
import { canEmbedInPdf, canOutline, fontFaceCss, fontInfo, textPathData, woffToSfnt } from '../src/engine/design/exportText';
import { newTextLayer } from '../src/engine/design/doc';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import { loadFontFile } from '../src/engine/fontFiles';
import { addFonts, removeFont } from '../src/engine/ownFonts';
import { useStore } from '../src/store/store';

const woff = new Uint8Array(readFileSync('node_modules/@fontsource/inter/files/inter-latin-700-normal.woff'));
const ttf = new Uint8Array(woffToSfnt(woff));

describe('own fonts', () => {
  let kit: string;
  const item = () => useStore.getState().library.find((s) => s.id === kit)!;
  beforeEach(async () => {
    resetStore();
    vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this); } });
    kit = (await createItem({ name: 'Marea', kind: 'brand-kit', tokens: { sea: { type: 'color', value: '#0a4d68' } }, space: 'library', by: 'user' })).subject.id;
  });

  it('reads the name, weight and kind of a file', () => {
    expect(fontInfo(woff)).toEqual({ family: 'Inter', weight: 700 });
    expect(fontInfo(ttf)).toEqual(fontInfo(woff));
    expect([canOutline(ttf), canEmbedInPdf(ttf)]).toEqual([true, true]);
    expect(fontInfo(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(fontInfo(ttf.slice(0, 40))).toBeNull();
  });

  it('a plain TTF gives outlines and an embedded rule of its kind', async () => {
    const l = newTextLayer('T', 'Hi', { x: 0, y: 0, width: 0 });
    expect((await textPathData(ttf, l, { lines: ['Hi'], width: 50, lineHeightPx: 20 }, 15))[0]).toEqual((await textPathData(woff, l, { lines: ['Hi'], width: 50, lineHeightPx: 20 }, 15))[0]);
    expect(fontFaceCss([{ family: 'X', weight: 700, woff: ttf }])).toContain("format('truetype')");
  });

  it('a file becomes a font of the brand, is found by exports and stays after a save', async () => {
    expect(await addFonts(kit, [new File([ttf], 'brand.ttf', { type: 'font/ttf' })])).toEqual(['Inter']);
    expect(item().tokens).toMatchObject({ sea: { value: '#0a4d68' }, 'font.1': { type: 'fontFamily', value: 'Inter' } });
    expect(item().fonts).toMatchObject([{ family: 'Inter', weight: 700, name: 'brand.ttf' }]);
    expect(await loadFontFile('Inter', 400)).toEqual(ttf);
    await saveItem({ subjectId: kit, mode: 'overwrite', space: 'library', by: 'user', tokens: item().tokens });
    expect(item().fonts).toHaveLength(1);
    const copy = await saveItem({ subjectId: kit, mode: 'copy', space: 'library', by: 'user' });
    expect(copy.fonts).toHaveLength(1);
    await addFonts(kit, [new File([ttf], 'again.ttf')]);
    expect(item().fonts).toMatchObject([{ name: 'again.ttf' }]);
    expect(Object.keys(item().tokens!)).toEqual(['sea', 'font.1']);
    removeFont(kit, 'Inter');
    expect(item().fonts).toEqual([]);
    await expect(addFonts(kit, [new File(['nope'], 'x.ttf')])).rejects.toThrow('not a TTF, OTF or WOFF');
  });

  it('a font the app does not bring is asked for by its name, safely', () => {
    expect(fontStack('Playfair Display')).toMatch(/^'Playfair Display', /);
    expect(fontStack("a';}<b")).toMatch(/^'ab', /);
    expect(fontNames([{ id: 'x', name: 'x', refAssetIds: [], tokens: { t: { type: 'fontFamily', value: 'Lora, serif' }, s: { type: 'fontFamily', value: 'Serif' } } }] as never)).toEqual(['Lora']);
  });
});
