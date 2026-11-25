import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetStore } from './library-kits-final-fixtures';
import { addTextLayer, addVectorLayer, getDoc, mutateDoc, newBlankDoc, patchLayer, undoDoc } from '../src/engine/design/actions';
import { docModes, installTokenSync, tokenChoices, tokenOf, tokenPatch } from '../src/engine/design/tokenBind';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import type { KitTokens } from '../src/engine/libraryTypes';
import type { TextLayer, VectorLayer } from '../src/engine/types';
import { setComposer } from '../src/store/store';

const TOKENS: KitTokens = { sea: { type: 'color', value: '#0a4d68', modes: { Dark: '#88ccee' } }, main: { type: 'color', value: '{sea}' }, title: { type: 'fontFamily', value: 'Playfair Display, serif' }, big: { type: 'dimension', value: '2rem' } };

describe('tokens in the Designer', () => {
  let sid: string, kit: string, doc: string, stop: () => void;
  const layer = <T>(i: number) => getDoc(sid, doc)!.layers[i] as T;
  const save = (tokens: KitTokens) => saveItem({ subjectId: kit, mode: 'overwrite', space: 'library', by: 'user', tokens });
  const pick = (name: string) => tokenChoices('color').find((c) => c.label === name)!.ref;
  beforeEach(async () => {
    sid = resetStore().id;
    stop = installTokenSync();
    kit = (await createItem({ name: 'Marea', kind: 'brand-kit', tokens: TOKENS, space: 'library', by: 'user' })).subject.id;
    setComposer({ kitId: kit });
    doc = newBlankDoc(sid, { label: 'A', width: 100, height: 100 }).id;
  });
  afterEach(() => { stop(); setComposer({ kitId: null }); });

  it('a change in the brand changes the designs that use it, and nothing else', async () => {
    addTextLayer(sid, doc, 'Hi', { x: 0, y: 0, width: 0 }, { ...tokenPatch('color', '#0a4d68', pick('main')) });
    addVectorLayer(sid, doc, [{ type: 'rect', x: 0, y: 0, w: 10, h: 10, strokeWidth: 1, radius: 0, stroke: '#0a4d68', ...tokenPatch('fill', '#0a4d68', pick('sea')) }]);
    mutateDoc(sid, doc, (d) => ({ ...d, ...tokenPatch('background', '#0a4d68', pick('sea')) }));
    await save({ ...TOKENS, sea: { type: 'color', value: '#ff0000' } });
    expect(layer<TextLayer>(0).color).toBe('#ff0000');
    expect(layer<VectorLayer>(1).shapes[0]).toMatchObject({ fill: '#ff0000', stroke: '#0a4d68' });
    expect(getDoc(sid, doc)!.background).toBe('#ff0000');
    // A color set by hand no longer follows the brand.
    patchLayer(sid, doc, layer<TextLayer>(0).id, { color: '#123456' } as never);
    await save({ ...TOKENS, sea: { type: 'color', value: '#00ff00' } });
    expect(layer<TextLayer>(0).color).toBe('#123456');
    expect(tokenOf(layer<TextLayer>(0), 'color')).toBeUndefined();
    expect(layer<VectorLayer>(1).shapes[0].fill).toBe('#00ff00');
    // Undo goes back to before the hand change, with today's brand color.
    undoDoc(sid, doc);
    expect(layer<TextLayer>(0).color).toBe('#00ff00');
  });

  it('the page has a mode', () => {
    addTextLayer(sid, doc, 'Hi', { x: 0, y: 0, width: 0 }, tokenPatch('color', '#0a4d68', pick('main')));
    expect(docModes(getDoc(sid, doc)!)).toEqual(['Dark']);
    mutateDoc(sid, doc, (d) => ({ ...d, tokenMode: 'Dark' }));
    expect(layer<TextLayer>(0).color).toBe('#88ccee');
    undoDoc(sid, doc);
    expect(layer<TextLayer>(0).color).toBe('#0a4d68');
  });

  it('the agent writes tokens by name; an unknown one is a plain color', async () => {
    addTextLayer(sid, doc, 'Hi', { x: 0, y: 0, width: 0 }, { color: '{main}', fontFamily: '{title}' });
    expect(layer<TextLayer>(0)).toMatchObject({ color: '#0a4d68', fontFamily: 'Playfair Display' });
    addTextLayer(sid, doc, 'Hi', { x: 0, y: 0, width: 0 }, { color: '{nope}' });
    expect(layer<TextLayer>(1).color).toBe('#000000');
    await save({ ...TOKENS, title: { type: 'fontFamily', value: 'Lora' } });
    expect(layer<TextLayer>(0).fontFamily).toBe('Lora');
  });

  it('sizes are px, gradients follow, and a removed entry leaves the value', async () => {
    const big = tokenChoices('dimension')[0].ref;
    expect(big.value).toBe(32);
    addTextLayer(sid, doc, 'Hi', { x: 0, y: 0, width: 0 }, { fontSize: 32, fontSizeToken: big });
    addVectorLayer(sid, doc, [{ type: 'rect', x: 0, y: 0, w: 10, h: 10, strokeWidth: 0, radius: 0, stroke: null, fill: '#fff', fillGradient: { kind: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, stops: [{ offset: 0, alpha: 1, ...tokenPatch('color', '#0a4d68', pick('sea')) }, { offset: 1, alpha: 1, color: '#ffffff' }] } }]);
    await save({ ...TOKENS, sea: { type: 'color', value: '#ff0000' }, big: { type: 'dimension', value: '40px' } });
    expect(layer<TextLayer>(0).fontSize).toBe(40);
    expect(layer<VectorLayer>(1).shapes[0].fillGradient!.stops.map((s) => s.color)).toEqual(['#ff0000', '#ffffff']);
    const { deleteItem } = await import('../src/engine/libraryVersions');
    await deleteItem(kit);
    expect(layer<TextLayer>(0).fontSize).toBe(40);
  });
});
