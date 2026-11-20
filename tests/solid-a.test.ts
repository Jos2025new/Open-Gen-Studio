import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
import { checkDirect } from '../src/engine/actions';
import { useStore } from '../src/store/store';
import { routeFits } from '../src/engine/routing';
import type { Asset, ModelSchema, ModelSummary } from '../src/engine/types';

/* Review SOLID (Opus + Neon, 2026-11-20), batch A: one rule per question, asked by the button, the plan and the send. */
const imageRef = 'atlas::solid-a-image';
const imgModel = { ref: imageRef, provider: 'atlas', id: 'solid-a-image', name: 'Solid A image', kind: 'image', acceptsText: true, acceptsImage: true, tags: [] } as ModelSummary;
const imgSchema: ModelSchema = { ref: imageRef, params: [], source: 'catalog', slots: { prompt: 'prompt', images: { key: 'imgs', max: 14, min: 0, multiple: true, format: 'url', total: 15 } } };
const asset = (id: string): Asset => ({ id, kind: 'image', name: id, mime: 'image/png', width: 32, height: 32, sessionId: 'test', origin: 'upload', stored: false, favorite: false, createdAt: 0 });
const initial = useStore.getState();
const ids = Array.from({ length: 13 }, (_, i) => `a${i}`);

beforeEach(() => {
  const st = useStore.getState();
  useStore.setState({
    assets: Object.fromEntries(ids.map((id) => [id, asset(id)])),
    catalog: { ...st.catalog, models: { ...st.catalog.models, [imageRef]: imgModel }, schemas: { ...st.catalog.schemas, [imageRef]: imgSchema } },
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'test-key' } },
  });
});
afterEach(() => useStore.setState(initial));

describe('1. one reference limit', () => {
  it('the composer button counts the per-call total (references + results) like the plan', () => {
    const st = useStore.getState();
    useStore.setState({ composer: { ...st.composer, mode: 'image', text: 'x', attachments: ids, image: { modelRef: imageRef, settings: { count: 3, advanced: {} } } } });
    expect(checkDirect('image')).toMatchObject({ ok: false, reason: expect.stringMatching(/up to 12 images/) });
    useStore.setState({ composer: { ...useStore.getState().composer, image: { modelRef: imageRef, settings: { count: 1, advanced: {} } } } });
    expect(checkDirect('image').ok).toBe(true);
  });
  it('routing reads the same list as the send when a schema has images and typed references', () => {
    const both: ModelSchema = { ...imgSchema, slots: { prompt: 'prompt', images: { key: 'i', max: 3, min: 0, multiple: true, format: 'url' }, mixedRefs: { key: 'm', max: 9, min: 0 } } };
    expect(routeFits({ ...imgModel, acceptsText: true }, both, { mode: 'reference', refs: 5 })).toBe(true);
  });
});
