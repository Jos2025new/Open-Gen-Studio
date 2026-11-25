import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from './library-kits-final-fixtures';
import { fontNames, fontStack } from '../src/engine/design/doc';
import { canEmbedInPdf, canOutline, fontFaceCss, fontInfo, textPathData, woffToSfnt } from '../src/engine/design/exportText';
import { newTextLayer } from '../src/engine/design/doc';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import { loadFontFile } from '../src/engine/fontFiles';
import { addFonts, removeFont } from '../src/engine/ownFonts';
import { handleUnbrotli } from '../server/brotli.js';
import { attachFiles, deleteSession, deleteSubject, saveSubject } from '../src/engine/actions';
import { attachmentLines } from '../src/engine/agent/attachments';
import { run } from '../src/engine/commands';
import { libraryContextLines } from '../src/engine/libraryGraph';
import { mentionableSubjects } from '../src/engine/libraryTypes';
import type { Asset } from '../src/engine/types';
import { createSession, useStore } from '../src/store/store';

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

  it('a font attached to a message is used at once and goes to Library when asked', async () => {
    const s1 = createSession('S1'), sid = s1.id, bytes = async () => loadFontFile('Inter', 700);
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: s1 }, activeSessionId: sid }));
    await attachFiles([new File([ttf], 'given.ttf')]);
    const st = useStore.getState(), fonts = st.sessions[sid].fonts!, [font] = fonts;
    expect(fonts).toMatchObject([{ family: 'Inter', weight: 700, name: 'given.ttf' }]);
    expect(st.composer.attachments).toEqual([font.id]);
    expect(attachmentLines([font.id], st.sessions[sid]).join()).toMatch(`${font.id} fontFamily="Inter" (weight 700) attached now`);
    expect(attachmentLines([], st.sessions[sid]).join()).toContain(font.id);
    expect(item().fonts).toBeUndefined();
    expect(st.library.find((s) => s.kind === 'font')).toMatchObject({ name: 'Inter', fonts: [font] });
    expect(await bytes()).toEqual(ttf);
    const add = (args: object) => run({ cmd: 'library.item.add', args: { id: kit, section: 'Fonts', ...args } }, { caller: 'agent' });
    expect(await add({ fonts: [font.id] })).toMatchObject({ ok: true });
    expect(item()).toMatchObject({ fonts: [font], tokens: { sea: { value: '#0a4d68' }, 'font.1': { type: 'fontFamily', value: 'Inter' } } });
    expect(await add({ fonts: ['font_none'] })).toMatchObject({ ok: false });
    expect(item().fonts).toHaveLength(1);
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], fonts: undefined } } }));
    expect(await bytes()).toEqual(ttf);
  });

  it('what is attached stays in Library unless the setting is off', async () => {
    const s1 = createSession('S1'), s2 = createSession('S2'), own = () => useStore.getState().library.filter((s) => s.kind === 'font');
    const asset = (id: string, kept?: boolean) => ({ id, kind: 'image', mime: 'image/png', width: 1, height: 1, sessionId: s1.id, origin: 'upload', stored: true, favorite: false, createdAt: 1, ...(kept ? { kept } : {}) }) as Asset;
    useStore.setState((s) => ({ sessions: { [s1.id]: s1, [s2.id]: s2 }, activeSessionId: s1.id, assets: { a: asset('a', true), b: asset('b') }, settings: { ...s.settings, keepAttachments: false } }));
    await attachFiles([new File([ttf], 'given.ttf')]);
    expect(own()).toEqual([]);
    useStore.setState((s) => ({ settings: { ...s.settings, keepAttachments: undefined } }));
    await attachFiles([new File([ttf], 'given.ttf')]);
    await attachFiles([new File([ttf], 'again.ttf')]);
    expect(own()).toMatchObject([{ name: 'Inter', fonts: [{ name: 'again.ttf' }] }]);
    const library = useStore.getState().library;
    expect(mentionableSubjects(library)).toEqual([]);
    expect(libraryContextLines(library).join()).toContain('fonts in Library');
    expect(() => saveSubject({ ...own()[0], kind: 'style' })).toThrow('is a font');
    deleteSession(s1.id);
    expect(Object.keys(useStore.getState().assets)).toEqual(['a']);
    expect(await loadFontFile('Inter', 700)).toEqual(ttf);
    deleteSubject(own()[0].id);
    expect(own()).toEqual([]);
  });

  it('a WOFF2 is kept as TTF', async () => {
    const packed = new Uint8Array(readFileSync('node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2'));
    vi.stubGlobal('fetch', async (_: string, init: { body: Uint8Array }) => { const r = await handleUnbrotli(init.body); return new Response(r.body as BodyInit, { status: r.status }); });
    expect(await addFonts(kit, [new File([packed], 'inter.woff2')])).toEqual(['Inter']);
    const data = (await loadFontFile('Inter', 700))!;
    expect([fontInfo(data), canOutline(data)]).toEqual([{ family: 'Inter', weight: 700 }, true]);
    await expect(addFonts(kit, [new File([packed.slice(0, 500)], 'x.woff2')])).rejects.toThrow('could not be read as a font');
  });

  it('fonts do not go in a moodboard', async () => {
    const board = (await createItem({ name: 'M', kind: 'moodboard', space: 'library', by: 'user' })).subject.id;
    await expect(addFonts(board, [new File([ttf], 'a.ttf')])).rejects.toThrow('brand kit or a design system');
  });

  it('a font the app does not bring is asked for by its name, safely', () => {
    expect(fontStack('Playfair Display')).toMatch(/^'Playfair Display', /);
    expect(fontStack("a';}<b")).toMatch(/^'ab', /);
    expect(fontNames([{ id: 'x', name: 'x', refAssetIds: [], tokens: { t: { type: 'fontFamily', value: 'Lora, serif' }, s: { type: 'fontFamily', value: 'Serif' } } }] as never)).toEqual(['Lora']);
  });
});
