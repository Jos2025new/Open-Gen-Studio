// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const blobs = vi.hoisted(() => new Map<string, Blob>());
vi.mock('../src/lib/idb', () => ({
  blobDb: { get: async (k: string) => blobs.get(k), set: async (k: string, b: Blob) => { blobs.set(k, b); }, delMany: async (ks: string[]) => { ks.forEach((k) => blobs.delete(k)); } },
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  putAssetBlob: async () => undefined, deleteAssetBlobs: async () => undefined,
}));
import { KitTokens } from '../src/components/gallery/KitTokens';
import { addFonts, removeFont } from '../src/engine/ownFonts';
import { addCategory, addToSection, kitSections, sectionNodes } from '../src/engine/librarySections';
import { mergeTokens } from '../src/engine/libraryTokens';
import { createItem, restoreItemVersion, saveItem } from '../src/engine/libraryVersions';
import type { KitFont } from '../src/engine/libraryTypes';
import { useStore } from '../src/store/store';

const item = (id: string) => useStore.getState().library.find((s) => s.id === id)!;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
let host: HTMLDivElement, root: Root, id = '';
const show = () => act(async () => { root.render(<KitTokens key={id} item={item(id)} types={['color']} />); });
const type = (label: string, value: string) => act(async () => {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
beforeEach(async () => {
  blobs.clear();
  useStore.setState({ library: [], assets: {} });
  id = (await createItem({ name: 'Marea', kind: 'brand-kit', tokens: { sea: { type: 'color', value: '#0a4d68' }, sand: { type: 'color', value: '#e8d8b0' } }, space: 'library', by: 'user' })).subject.id;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

describe('edits of the tokens are not lost', () => {
  it('leaving without Save keeps them, and leaving without edits makes no version', async () => {
    await show();
    await type('sea value', '#112233');
    await act(async () => { root.render(null); });
    await settle();
    expect(item(id).tokens!.sea.value).toBe('#112233');
    const versions = item(id).versions!.length;
    await show();
    await act(async () => { root.render(null); });
    await settle();
    expect(item(id).versions).toHaveLength(versions);
  });
  it('what another save brings while editing stays with the edits', async () => {
    await show();
    await type('sea value', '#112233');
    await act(async () => { await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'agent', tokens: { ...item(id).tokens, sand: { type: 'color', value: '#ffffff' }, coral: { type: 'color', value: '#ff7755' } } }); });
    await show();
    expect(host.querySelector<HTMLInputElement>('input[aria-label="sea value"]')!.value).toBe('#112233');
    expect(host.querySelector<HTMLInputElement>('input[aria-label="coral value"]')!.value).toBe('#ff7755');
    await act(async () => { host.querySelector<HTMLFormElement>('form')!.requestSubmit(); });
    await settle();
    expect(item(id).tokens).toMatchObject({ sea: { value: '#112233' }, sand: { value: '#ffffff' }, coral: { value: '#ff7755' } });
    const versions = item(id).versions!.length;
    await act(async () => { root.render(null); });
    await settle();
    expect(item(id).versions).toHaveLength(versions);
  });
  it('a row half written is told and not saved', async () => {
    await show();
    const [name] = host.querySelectorAll<HTMLInputElement>('input[aria-label="Token name"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, ''); name.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { root.render(null); });
    await settle();
    expect(Object.keys(item(id).tokens!)).toEqual(['sea', 'sand']);
    expect(useStore.getState().ui.toasts.map((t) => t.text).join()).toContain('Not saved: Every token needs a name.');
  });
  it('merges by token: edited, added, removed on either side', () => {
    const c = (value: string) => ({ type: 'color' as const, value });
    expect(mergeTokens({ a: c('#1'), b: c('#2'), d: c('#4') }, { a: c('#9'), d: c('#4'), e: c('#5') }, { a: c('#8'), b: c('#2'), f: c('#6') }))
      .toEqual({ a: c('#9'), e: c('#5'), f: c('#6') });
  });
});

describe('versions carry the fonts and the categories', () => {
  const inter: KitFont = { id: 'font_1', family: 'Inter', weight: 400, name: 'inter.ttf' } as KitFont;
  it('restoring brings back a removed font with its token, and the categories of then', async () => {
    addCategory(id, 'Posters');
    const { subject } = { subject: await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', fonts: () => [inter], tokens: (t) => ({ ...t, 'font.1': { type: 'fontFamily', value: 'Inter' } }) }) };
    await removeFont(id, 'Inter');
    expect(item(id).fonts).toEqual([]);
    expect(item(id).tokens!['font.1']).toBeUndefined();
    useStore.setState((st) => ({ library: st.library.map((s) => (s.id === id ? { ...s, sections: [] } : s)) }));
    await restoreItemVersion({ subjectId: id, versionId: subject.versionId!, space: 'library', by: 'user' });
    expect(item(id).fonts).toEqual([inter]);
    expect(item(id).tokens!['font.1']).toMatchObject({ value: 'Inter' });
    expect(kitSections(item(id)).some((s) => s.title === 'Posters')).toBe(true);
  });
  it('a version saved before this keeps the fonts of the entry', async () => {
    const old = item(id).versionId!, key = `libver:${old}`, snap = JSON.parse(await blobs.get(key)!.text());
    delete snap.fonts; delete snap.sections;
    blobs.set(key, new Blob([JSON.stringify(snap)]));
    await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', fonts: () => [inter] });
    await restoreItemVersion({ subjectId: id, versionId: old, space: 'library', by: 'user' });
    expect(item(id).fonts).toEqual([inter]);
  });
  it('removing a font keeps its token when another points to it', async () => {
    await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', fonts: () => [inter], tokens: (t) => ({ ...t, 'font.1': { type: 'fontFamily', value: 'Inter' }, heading: { type: 'fontFamily', value: '{font.1}' } }) });
    await removeFont(id, 'Inter');
    expect(Object.keys(item(id).tokens!)).toEqual(['sea', 'sand', 'font.1', 'heading']);
  });
  it('a file that is no font changes nothing', async () => {
    const before = item(id).versionId;
    await expect(addFonts(id, [new File(['x'], 'x.ttf')])).rejects.toThrow();
    expect(item(id).versionId).toBe(before);
  });
});

it('an image without a section already shows in Photos and is not added twice', async () => {
  useStore.setState({ assets: { a: { id: 'a', kind: 'image', name: 'Dune', width: 10, height: 10, createdAt: 1 } as never } });
  await saveItem({ subjectId: id, mode: 'overwrite', space: 'library', by: 'user', graph: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Dune', assetId: 'a' } }], edges: [] } });
  await addToSection(id, 'Photos', { assetIds: ['a'] });
  expect(sectionNodes(item(id), { title: 'Photos' })).toHaveLength(1);
});
