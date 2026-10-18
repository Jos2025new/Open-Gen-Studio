import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined,
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
}));

const TEXT = 'atlas::journey/banana/text-to-image';
const EDIT = 'atlas::journey/banana/edit';

describe('direct check with an image on a text-only model', () => {
  it('checks the family edit variant instead of refusing the reference (Create space)', async () => {
    vi.stubGlobal('fetch', async (u: string) => { throw new Error(`blocked ${u}`); });
    const [{ useStore }, { checkDirect }] = await Promise.all([import('../src/store/store'), import('../src/engine/actions')]);
    const st = useStore.getState();
    useStore.setState({
      catalog: { ...st.catalog, status: { ...st.catalog.status, atlas: 'ready' },
        models: {
          [TEXT]: { ref: TEXT, provider: 'atlas', id: 'journey/banana/text-to-image', name: 'Banana', kind: 'image', acceptsText: true, acceptsImage: false, tags: [] },
          [EDIT]: { ref: EDIT, provider: 'atlas', id: 'journey/banana/edit', name: 'Banana edit', kind: 'image', acceptsText: true, acceptsImage: true, tags: [] },
        } as never,
        schemas: {
          [TEXT]: { ref: TEXT, params: [], slots: { prompt: 'prompt', promptRequired: true } },
          [EDIT]: { ref: EDIT, params: [], slots: { prompt: 'prompt', images: { key: 'image_urls', max: 4, min: 1, multiple: true, format: 'url' } } },
        } as never },
      settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'test-only' } },
      composer: { ...st.composer, mode: 'image', text: 'side view', image: { ...st.composer.image, modelRef: TEXT }, attachments: ['a'] },
      assets: { a: { id: 'a', sessionId: 't', kind: 'image', mime: 'image/png', width: 1, height: 1, createdAt: 1 } } as never,
    });
    const check = checkDirect('image');
    expect(check.reason ?? '').not.toMatch(/does not accept reference images/);
    useStore.setState({ composer: { ...useStore.getState().composer, attachments: [] } });
    expect(checkDirect('image').reason ?? '').not.toMatch(/reference/);
    vi.unstubAllGlobals();
  });
});
