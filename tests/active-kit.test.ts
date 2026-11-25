import { beforeEach, describe, expect, it } from 'vitest';
import { asset, graphOf, mkAsset, putImageBlob, resetStore } from './library-kits-final-fixtures';
import { createItem, libraryToDesigner, saveItem } from '../src/engine/libraryVersions';
import { activeKitColors, activeKitImages, activeKitLines, loadActiveKit } from '../src/engine/activeKit';
import { buildContext } from '../src/engine/agent/context';
import { addTextLayer } from '../src/engine/design/actions';
import { tokensFromFile, tokensToFile } from '../src/engine/libraryTokensFile';
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

  it('a removed entry is simply no longer active', () => {
    setComposer({ kitId: 'gone' });
    expect(activeKitLines()).toEqual([]);
  });
});

describe('token files', () => {
  it('go out and come back the same', () => {
    const tokens = { 'color.sea': { type: 'color' as const, value: '#0a4d68', description: 'Deep' }, 'color.main': { type: 'color' as const, value: '{color.sea}' }, 'space.m': { type: 'dimension' as const, value: '16px' }, 'font.title': { type: 'fontFamily' as const, value: 'Inter' }, weight: { type: 'number' as const, value: 700 } };
    expect(tokensFromFile(tokensToFile(tokens))).toEqual({ tokens, skipped: [] });
  });

  it('reads token sets, inherited types and other tools’ types, and says what it could not read', () => {
    const file = { $themes: [], $metadata: { tokenSetOrder: ['Global', 'Light mode'] },
      Global: { brand: { $type: 'color', 'deep sea': { $value: '#0A4D68' } }, radius: { $type: 'borderRadius', $value: '8' }, body: { $type: 'fontFamilies', $value: ['Inter', 'Arial'] }, pad: { $type: 'spacing', $value: '{radius}*2' }, title: { $type: 'typography', $value: { fontSize: '12' } } },
      'Light mode': { accent: { $type: 'color', $value: '{brand.deep sea}' } } };
    const { tokens, skipped } = tokensFromFile(JSON.stringify(file));
    expect(tokens).toEqual({ 'brand.deep-sea': { type: 'color', value: '#0A4D68' }, radius: { type: 'dimension', value: '8' }, body: { type: 'fontFamily', value: 'Inter, Arial' }, accent: { type: 'color', value: '{brand.deep-sea}' } });
    expect(skipped.sort()).toEqual(['pad', 'title']);
    expect(() => tokensFromFile('nope')).toThrow('not valid JSON');
  });
});
