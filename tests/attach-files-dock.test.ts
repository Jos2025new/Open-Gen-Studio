// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  putAssetBlob: async () => undefined,
}));
vi.mock('../src/lib/media', async (original) => ({
  ...await original<typeof import('../src/lib/media')>(),
  probeMedia: async () => ({ width: 20, height: 20 }),
}));
const drawn = vi.hoisted(() => ({ out: new Blob(['png'], { type: 'image/png' }) as Blob | string }));
vi.mock('../src/engine/design/svgImport/flatten', () => ({ flattenSvg: async () => drawn.out }));
import { attachFiles } from '../src/engine/actions';
import { useStore } from '../src/store/store';

beforeEach(() => {
  const st = useStore.getState();
  useStore.setState({ ui: { ...st.ui, workspace: 'designer', designerDock: 'tools' }, composer: { ...st.composer, attachments: [] } });
});
describe('attachments from the Designer tools dock', () => {
  it('reveals the prompt and its successfully attached references', async () => {
    await attachFiles([new File(['image'], 'reference.png', { type: 'image/png' })]);
    expect(useStore.getState().composer.attachments).toHaveLength(1);
    expect(useStore.getState().ui.designerDock).toBe('prompt');
  });
  it('keeps the tools when no file is selected or accepted', async () => {
    await attachFiles([]);
    await attachFiles([new File(['text'], 'note.txt', { type: 'text/plain' })]);
    expect(useStore.getState().composer.attachments).toEqual([]);
    expect(useStore.getState().ui.designerDock).toBe('tools');
  });
  it('does not change the dock preference when attaching in Chat', async () => {
    const st = useStore.getState();
    useStore.setState({ ui: { ...st.ui, workspace: 'chat' } });
    await attachFiles([new File(['image'], 'reference.png', { type: 'image/png' })]);
    expect(useStore.getState().composer.attachments).toHaveLength(1);
    expect(useStore.getState().ui.designerDock).toBe('tools');
  });
  it('takes an SVG as a PNG, and one that cannot be drawn is not attached', async () => {
    const svg = () => new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.svg', { type: 'image/svg+xml' });
    await attachFiles([svg()]);
    const [id] = useStore.getState().composer.attachments;
    expect(useStore.getState().assets[id]).toMatchObject({ kind: 'image', mime: 'image/png' });
    drawn.out = 'The browser could not draw this SVG.';
    await attachFiles([svg()]);
    expect(useStore.getState().composer.attachments).toEqual([id]);
  });
});
