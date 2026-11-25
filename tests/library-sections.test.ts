import { beforeEach, describe, expect, it } from 'vitest';
import { mkAsset, putImageBlob, resetStore } from './library-kits-final-fixtures';
import { setComposer, useStore } from '../src/store/store';
import { addCategory, addToSection, kitSections, moveToSection, removeFromSection, sectionNodes } from '../src/engine/librarySections';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import { libraryToNodes, nodesToLibrary } from '../src/engine/flow/fromLibrary';
import { activeKitImages, activeKitLines } from '../src/engine/activeKit';

const item = (id: string) => useStore.getState().library.find((s) => s.id === id)!;
const titled = (id: string, title: string) => sectionNodes(item(id), kitSections(item(id)).find((s) => s.title === title)!);
describe('sections of a brand kit', () => {
  let kit = '';
  beforeEach(async () => {
    const sid = resetStore().id;
    useStore.setState({ activeSessionId: sid, assets: { logo: mkAsset('logo', sid), photo: mkAsset('photo', sid) } });
    putImageBlob('logo'); putImageBlob('photo');
    setComposer({ kitId: null });
    kit = (await createItem({ name: 'Marea', kind: 'brand-kit', space: 'library', by: 'user', open: false, draft: false })).subject.id;
  });
  it('keeps images and texts in their section and moves them', async () => {
    await addToSection(kit, 'logos', { assetIds: ['logo'] });
    await addToSection(kit, 'Voice', { texts: ['Close and calm.'] });
    await addToSection(kit, 'Stickers', { assetIds: ['photo'] }, 'agent');
    expect(titled(kit, 'Logos')).toHaveLength(1);
    expect(titled(kit, 'Voice')).toHaveLength(1);
    expect(kitSections(item(kit)).find((s) => s.title === 'Stickers')?.custom).toBe(true);
    const node = titled(kit, 'Stickers')[0];
    await moveToSection(kit, node.id, 'Photos');
    expect(titled(kit, 'Photos').map((n) => n.id)).toEqual([node.id]);
    await removeFromSection(kit, node.id);
    expect(titled(kit, 'Photos')).toEqual([]);
    await expect(addToSection(kit, 'Colors', { assetIds: ['logo'] })).rejects.toThrow('holds no images');
  });
  it('shows what has no section under photos, and an empty category stays', async () => {
    await saveItem({ subjectId: kit, mode: 'overwrite', space: 'library', by: 'user', graph: { nodes: [{ id: 'n', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'P', assetId: 'photo' } }], edges: [] } });
    expect(titled(kit, 'Photos')).toHaveLength(1);
    addCategory(kit, 'Packaging');
    await saveItem({ subjectId: kit, mode: 'overwrite', space: 'library', by: 'user', name: 'Marea 2' });
    expect(kitSections(item(kit)).some((s) => s.title === 'Packaging')).toBe(true);
    expect((await saveItem({ subjectId: kit, mode: 'copy', space: 'library', by: 'user' })).sections).toEqual(['Packaging']);
  });
  it('keeps the sections through Nodes and back', async () => {
    const st = useStore.getState(), session = st.activeSessionId;
    await addToSection(kit, 'Logos', { assetIds: ['logo'] });
    const { groupId } = libraryToNodes(session, kit);
    await nodesToLibrary({ sessionId: session, mode: 'overwrite', subjectId: kit, groupId: groupId! });
    expect(titled(kit, 'Logos')).toHaveLength(1);
  });
  it('the agent reads them, logos first, with what its design system contains', async () => {
    const mood = (await createItem({ name: 'Sea', kind: 'moodboard', space: 'library', by: 'user', open: false, draft: false })).subject.id;
    const ds = (await createItem({ name: 'System', kind: 'design-system', space: 'library', by: 'user', open: false, draft: false, kits: [mood] })).subject.id;
    await addToSection(kit, 'Photos', { assetIds: ['photo'] });
    await addToSection(kit, 'Logos', { assetIds: ['logo'] });
    await saveItem({ subjectId: kit, mode: 'overwrite', space: 'library', by: 'user', kits: [ds] });
    setComposer({ kitId: kit });
    expect(activeKitImages()).toEqual(['logo', 'photo']);
    const text = activeKitLines().join('\n');
    expect(text).toContain('in Logos');
    expect(text).toContain('"Sea"');
  });
});
