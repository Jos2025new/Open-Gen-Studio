import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetStore } from './library-kits-final-fixtures';
import { addTextLayer, getDoc, newBlankDoc, undoDoc } from '../src/engine/design/actions';
import { openHistoryGroup } from '../src/engine/design/history';
import { patchLayer } from '../src/engine/design/actions';
import { brandToDoc, installBrandStarts, installTokenSync, tokenOf } from '../src/engine/design/tokenBind';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import type { KitTokens } from '../src/engine/libraryTypes';
import type { TextLayer } from '../src/engine/types';
import { setComposer, setUi, useStore } from '../src/store/store';

const TOKENS: KitTokens = { marron: { type: 'color', value: '#3b2416' }, crema: { type: 'color', value: '#f2e3c6' }, marca: { type: 'fontFamily', value: 'Liberation Sans' } };

describe('the brand in use reaches the tools (what a first-time user expects)', () => {
  let sid: string, stops: Array<() => void>;
  const ui = () => useStore.getState().ui;
  beforeEach(() => { sid = resetStore().id; setComposer({ kitId: null }); stops = [installTokenSync(), installBrandStarts()]; });
  afterEach(() => { stops.forEach((s) => s()); setComposer({ kitId: null }); });

  it('a brand kit the user creates is in use; one the agent creates is not', async () => {
    const mine = (await createItem({ name: 'Brasa', kind: 'brand-kit', space: 'library', by: 'user' })).subject.id;
    expect(useStore.getState().composer.kitId).toBe(mine);
    await createItem({ name: 'Other', kind: 'brand-kit', space: 'library', by: 'agent' });
    await createItem({ name: 'Third', kind: 'design-system', space: 'library', by: 'user' });
    expect(useStore.getState().composer.kitId).toBe(mine);
  });

  it('new texts and shapes start with its first font and color, linked, and follow the token', async () => {
    const kit = (await createItem({ name: 'Brasa', kind: 'brand-kit', space: 'library', by: 'user' })).subject.id;
    await saveItem({ subjectId: kit, mode: 'overwrite', space: 'library', by: 'user', tokens: TOKENS });
    expect(ui().text).toMatchObject({ color: '#3b2416', fontFamily: 'Liberation Sans' });
    expect(tokenOf(ui().text, 'color')?.token).toBe('marron');
    expect(tokenOf(ui().shape, 'fill')?.token).toBe('marron');
    const doc = newBlankDoc(sid, { label: 'P', width: 100, height: 100 }).id;
    addTextLayer(sid, doc, 'BRASA', { x: 0, y: 0, width: 0 }, ui().text);
    await saveItem({ subjectId: kit, mode: 'overwrite', space: 'library', by: 'user', tokens: { ...TOKENS, marron: { type: 'color', value: '#8c3a2b' } } });
    expect((getDoc(sid, doc)!.layers[0] as TextLayer).color).toBe('#8c3a2b');
    expect(ui().text.color).toBe('#8c3a2b');
  });

  it('a color picked by hand stays until the brand changes', async () => {
    const kit = (await createItem({ name: 'Brasa', kind: 'brand-kit', space: 'library', by: 'user', tokens: TOKENS })).subject.id;
    expect(ui().text.color).toBe('#3b2416');
    setUi({ text: { ...ui().text, color: '#ffffff', colorToken: undefined } });
    await saveItem({ subjectId: kit, mode: 'overwrite', space: 'library', by: 'user', tokens: { ...TOKENS, crema: { type: 'color', value: '#ffeedd' } } });
    expect(ui().text.color).toBe('#ffffff');
    setComposer({ kitId: null });
    setComposer({ kitId: kit });
    expect(ui().text.color).toBe('#3b2416');
  });

  it('Use puts the brand on the texts already placed that follow no token, in one undo step', async () => {
    const doc = newBlankDoc(sid, { label: 'P', width: 100, height: 100 }).id;
    addTextLayer(sid, doc, 'BRASA', { x: 0, y: 0, width: 0 }, { color: '#ffffff', fontFamily: 'Inter' });
    const kit = (await createItem({ name: 'Brasa', kind: 'brand-kit', space: 'library', by: 'agent', tokens: TOKENS })).subject.id;
    setComposer({ kitId: kit });
    const group = openHistoryGroup(doc);
    expect(brandToDoc(getDoc(sid, doc)!, (id, p) => patchLayer(sid, doc, id, p))).toBe(1);
    group.close();
    const t = getDoc(sid, doc)!.layers[0] as TextLayer;
    expect(t).toMatchObject({ color: '#3b2416', fontFamily: 'Liberation Sans' });
    expect(tokenOf(t, 'color')?.token).toBe('marron');
    undoDoc(sid, doc);
    expect(getDoc(sid, doc)!.layers[0]).toMatchObject({ color: '#ffffff', fontFamily: 'Inter' });
  });
});
