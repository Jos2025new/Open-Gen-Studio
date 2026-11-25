import { beforeEach, describe, expect, it } from 'vitest';
import { asset, graphOf, mkAsset, putImageBlob, resetStore } from './library-kits-final-fixtures';
import { createItem, libraryToDesigner, saveItem } from '../src/engine/libraryVersions';
import { activeKitColors, activeKitImages, activeKitLines, loadActiveKit } from '../src/engine/activeKit';
import { buildContext } from '../src/engine/agent/context';
import { addTextLayer } from '../src/engine/design/actions';
import { setComposer, useStore } from '../src/store/store';

const ctx = (workspace: 'chat' | 'designer' = 'chat') => buildContext(useStore.getState().sessions[useStore.getState().activeSessionId], { workspace, style: 'auto', round: 0, maxRounds: 2, attachments: [] });

describe('the brand the agent works with', () => {
  let sid: string;
  beforeEach(() => {
    sid = resetStore().id;
    useStore.setState({ activeSessionId: sid, assets: { a: mkAsset('a', sid) } });
    putImageBlob('a');
    setComposer({ kitId: null });
  });

  it('a brand kit with a moodboard inside reaches every request: colors, fonts, tokens, images and what it contains', async () => {
    const mood = (await createItem({ name: 'Coast', kind: 'moodboard', graph: graphOf(asset('a', 100, 100)), space: 'library', by: 'user' })).subject;
    const kit = (await createItem({ name: 'Marea', kind: 'brand-kit', description: 'Calm seafood brand', kits: [mood.id], tokens: { 'color.sea': { type: 'color', value: '#0A4D68' }, 'color.main': { type: 'color', value: '{color.sea}' }, 'font.title': { type: 'fontFamily', value: 'Playfair Display' } }, space: 'library', by: 'user' })).subject;
    const doc = await libraryToDesigner(sid, kit.id);
    addTextLayer(sid, doc.id, 'Marea', { x: 10, y: 10, width: 200 }, { color: '#FF7700' });
    await saveItem({ subjectId: kit.id, sessionId: sid, docId: doc.id, mode: 'overwrite', space: 'designer', by: 'user' });
    expect(ctx()).not.toContain('Marea');
    setComposer({ kitId: kit.id });
    await loadActiveKit();
    const text = ctx();
    for (const part of ['active brand kit (picked by the user', '"Marea"', 'Calm seafood brand', 'color.sea (color): #0A4D68', 'Playfair Display', '#FF7700', 'inside it:', '"Coast"', 'asset:a']) expect(text).toContain(part);
    expect(ctx('designer')).toContain('active brand kit');
    expect(activeKitImages()).toEqual(['a']);
    expect(activeKitColors()).toEqual(['#0a4d68']);
    setComposer({ kitId: null });
    expect(activeKitLines()).toEqual([]);
  });

  it('what it contains has one total, and the rest is named to be read by id', async () => {
    const boards = [];
    for (let i = 0; i < 9; i++) boards.push((await createItem({ name: `Board ${i}`, kind: 'design-system', description: 'x'.repeat(190), tokens: Object.fromEntries(Array.from({ length: 40 }, (_, n) => [`t${n}`, { type: 'color' as const, value: '#0a4d68' }])), space: 'library', by: 'user' })).subject.id);
    setComposer({ kitId: (await createItem({ name: 'Marea', kind: 'brand-kit', kits: boards, space: 'library', by: 'user' })).subject.id });
    const text = activeKitLines().join('\n');
    expect(text.length).toBeLessThan(2500 + 4800 + 1200);
    expect(text).toMatch(/also inside it \(library\.item\.read to inspect\): .*"Board 8"/);
    expect(text).toContain('inside it:');
  });

  it('a removed entry is simply no longer active', () => {
    setComposer({ kitId: 'gone' });
    expect(activeKitLines()).toEqual([]);
  });
});
