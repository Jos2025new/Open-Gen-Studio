import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetStore } from './library-kits-final-fixtures';
import { addTextLayer, addVectorLayer, getDoc, mutateDoc, newBlankDoc, patchLayer, undoDoc } from '../src/engine/design/actions';
import { docModes, installTokenSync, tokenChoices, tokenOf, tokenPatch, tokenProblem } from '../src/engine/design/tokenBind';
import { runCommandsTool } from '../src/engine/agent/commandCalls';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import type { KitTokens } from '../src/engine/libraryTypes';
import type { TextLayer, VectorLayer } from '../src/engine/types';
import { run } from '../src/engine/commands';
import { activeKitLines } from '../src/engine/activeKit';
import { setComposer, useStore } from '../src/store/store';

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

  it('the agent is told which token does not exist and which ones do', async () => {
    const say = (args: object) => runCommandsTool(sid, { seq: [{ cmd: 'designer.layer.add_text', args: { text: 'Hi {name}', x: 0, y: 0, width: 0, ...args } }] });
    const bad = await say({ style: { color: '{nope}', fontFamily: '{title}' } });
    expect(bad).toMatchObject({ done: false });
    expect(bad.text).toMatch(/no token "\{nope\}" in .*color: .*main.*Nothing ran/);
    expect(getDoc(sid, doc)!.layers).toHaveLength(0);
    expect((await say({ style: { color: '{main}', fontFamily: '{title}' } })).done).toBe(true);
    expect(layer<TextLayer>(0)).toMatchObject({ text: 'Hi {name}', color: '#0a4d68' });
    expect(tokenProblem({ shapes: [{ fill: '{title}', fillGradient: { stops: [{ color: '{gone}' }] } }] })).toMatch(/"\{title\}", "\{gone\}"/);
    setComposer({ kitId: null });
    expect(tokenProblem({ fill: '{main}' })).toMatch(/no brand is in use/);
    expect(tokenProblem({ fill: '#fff', text: '{main}' })).toBeNull();
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

  it('the design of an entry uses its tokens with no brand in use, and the agent reads them', async () => {
    const { openItem } = { openItem: (await import('../src/engine/libraryVersions')).libraryToDesigner };
    setComposer({ kitId: null });
    await openItem(sid, kit);
    const own = getDoc(sid, useStore.getState().sessions[sid].activeDocId!)!;
    expect(own.library?.subjectId).toBe(kit);
    expect(tokenChoices('color', undefined, kit).map((c) => c.label)).toEqual(['sea', 'main']);
    expect(tokenProblem({ fill: '{main}' }, kit)).toBeNull();
    expect(activeKitLines(undefined, kit)[0]).toMatch(/^the document on screen is of this brand kit:\n.*Marea/s);
    expect(activeKitLines(undefined, kit).join()).not.toContain('picked by the user');
    const res = await runCommandsTool(sid, { seq: [{ cmd: 'designer.layer.add_text', args: { text: 'Own', x: 0, y: 0, width: 0, style: { color: '{main}', fontSize: '{big}', italic: true } } }] });
    expect(res.text).not.toMatch(/no token/);
    expect(getDoc(sid, own.id)!.layers.find((l) => l.type === 'text' && l.text === 'Own')).toMatchObject({ color: '#0a4d68', fontSize: 32, italic: true, fontSizeToken: { kit, token: 'big', value: 32 } });
  });

  it('sizes and the page background are written as tokens; one that does not exist is refused', async () => {
    const say = (seq: unknown[]) => runCommandsTool(sid, { seq });
    const made = await say([{ cmd: 'designer.doc.new', args: { width: 200, height: 200, background: '{sea}' } }, { cmd: 'designer.layer.add_text', args: { text: 'T', x: 0, y: 0, width: 0, style: { fontSize: '{big}' } } }]);
    expect(made.done).toBe(true);
    const page = getDoc(sid, useStore.getState().sessions[sid].activeDocId!)!;
    expect(page).toMatchObject({ background: '#0a4d68', backgroundToken: { token: 'sea' } });
    await save({ ...TOKENS, big: { type: 'dimension', value: '48px' } });
    expect(getDoc(sid, page.id)!.layers.find((l) => l.type === 'text')).toMatchObject({ fontSize: 48 });
    expect((await say([{ cmd: 'designer.layer.add_text', args: { text: 'T', x: 0, y: 0, width: 0, style: { fontSize: '{huge}' } } }])).text).toMatch(/no token "\{huge\}"/);
    expect((await say([{ cmd: 'designer.doc.new', args: { width: 200, height: 200, background: 'blue' } }])).done).toBe(false);
  });

  it('a design becomes a new entry from the agent too, and stays linked to it', async () => {
    const res = await run({ cmd: 'library.item.save', on: { session: sid }, args: { mode: 'new', kind: 'design-system', name: 'Cards', doc } }, { caller: 'agent' });
    expect(res.ok).toBe(true);
    const made = useStore.getState().library.find((s) => s.name === 'Cards')!;
    expect(made.kind).toBe('design-system');
    expect(getDoc(sid, doc)!.library).toMatchObject({ subjectId: made.id, versionId: made.versionId });
    const again = await run({ cmd: 'library.item.save', on: { session: sid }, args: { mode: 'new', kind: 'design-system', name: 'Cards 2', doc } }, { caller: 'agent' });
    expect(again.ok).toBe(false);
    expect(useStore.getState().library.some((s) => s.name === 'Cards 2')).toBe(false);
  });
});
