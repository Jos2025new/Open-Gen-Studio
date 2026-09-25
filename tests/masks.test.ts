import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import atlasSnapshot from './fixtures/live/atlas.json';
import falSnapshot from './fixtures/live/fal.json';
import { schemaFromJson, type JsonProp } from '../src/engine/params';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { createGeneration, opSpec, runGeneration } from '../src/engine/jobs';
import { opModelFor } from '../src/engine/catalog';
import { AGENT_OP_IDS, opsFor } from '../src/engine/ops';
import { whiteToAlpha } from '../src/lib/media';
import { useStore } from '../src/store/store';
import type { Asset, ModelSchema, ModelSummary } from '../src/engine/types';

// Node lacks the browser pieces the runner touches: window timers, IndexedDB, canvas/FileReader encoding.
const fakeWindow = vi.hoisted(() => {
  const w = { setTimeout, clearTimeout, addEventListener: () => undefined };
  Object.assign(globalThis, { window: w, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
  return w;
});
const blobs = new Map<string, Blob>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async (id: string) => blobs.get(id),
  putAssetBlob: async (id: string, b: Blob) => (blobs.set(id, b), id),
}));
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  prepareImageForUpload: async (b: Blob) => b,
  // The alpha conversion needs a canvas: tag the blob so the test sees it was converted.
  maskToAlpha: async (b: Blob) => Object.assign(new Blob([b], { type: 'image/png' }), { tag: `${(b as Blob & { tag?: string }).tag}-alpha` }),
  blobToDataUrl: async (b: Blob) => `data:${b.type};base64,${(b as Blob & { tag?: string }).tag ?? 'x'}`,
}));

type Loose = any;
function falSchema(id: string): ModelSchema {
  const doc = (falSnapshot as Loose).models.find((m: Loose) => m.endpoint_id === id).schemaDoc;
  const schemas = doc.components.schemas;
  const input = schemas[doc.paths[`/${id}`].post.requestBody.content['application/json'].schema.$ref.split('/').pop()];
  return schemaFromJson({ ref: `fal::${id}`, kind: 'image', properties: input.properties as Record<string, JsonProp>, required: input.required ?? [], resolve: (r) => schemas[r.split('/').pop()!], imageFormat: 'data-url', source: 'openapi' });
}
const image = (id: string, w = 1024, h = 768, origin: Asset['origin'] = 'upload'): Asset => ({ id, kind: 'image', mime: 'image/png', width: w, height: h, sessionId: 's', origin, stored: true, favorite: false, createdAt: 0 }) as Asset;

function install(refs: string[], opsOverride: Record<string, string | null> = {}, maskSize: [number, number] = [1024, 768]) {
  for (const id of ['photo', 'mask']) blobs.set(id, Object.assign(new Blob([new Uint8Array(4)], { type: 'image/png' }), { tag: id }));
  const st = useStore.getState();
  const models: Record<string, ModelSummary> = {};
  const schemas: Record<string, ModelSchema> = {};
  for (const ref of refs) {
    const id = ref.slice(5);
    models[ref] = { ref, provider: 'fal', id, name: id, kind: 'image', acceptsText: true, acceptsImage: true, tags: [] };
    schemas[ref] = falSchema(id);
  }
  useStore.setState({
    assets: { photo: image('photo'), mask: image('mask', maskSize[0], maskSize[1], 'mask') },
    catalog: { ...st.catalog, models, schemas },
    settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k', atlas: '', nanogpt: '' }, ops: { ...st.settings.ops, editRegion: null, removeObject: null, ...opsOverride } },
  });
}
async function capture(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.startsWith('https://queue.fal.run/')) {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ detail: 'stop here' }), { status: 400 });
    }
    throw new Error(`unexpected ${url}`);
  });
  await expect(run()).rejects.toThrow('stop here');
  return body;
}
const runOp = async (op: 'edit_region' | 'remove_object', params: Record<string, string>) => runGeneration(createGeneration(await opSpec({ sessionId: 's', sourceAssetId: 'photo', op, params, origin: 'op' })).id);

beforeEach(() => vi.stubGlobal('location', { href: 'http://localhost/' }));
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(globalThis, { window: fakeWindow });
});

describe('inpainting masks', () => {
  it('turns white (change) into transparent and black (keep) into opaque for OpenAI masks', () => {
    expect([...whiteToAlpha(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))]).toEqual([0, 0, 0, 0, 0, 0, 0, 255]);
    const atlas = (atlasSnapshot as Loose).models.find((m: Loose) => m.model === 'openai/gpt-image-2.5-flare/edit').schemaDoc.components.schemas;
    const s = schemaFromJson({ ref: 'atlas::openai/gpt-image-2.5-flare/edit', kind: 'image', properties: atlas.Input.properties, required: atlas.Input.required ?? [], resolve: () => undefined, imageFormat: 'url', source: 'openapi' });
    expect(s.slots.mask).toMatchObject({ key: 'mask', convention: 'alpha', required: false });
  });

  it('sends the white mask as drawn to Ideogram, and the alpha version to GPT Image', async () => {
    install(['fal::fal-ai/ideogram/v3/edit', 'fal::openai/gpt-image-2/edit']);
    const ideogram = await capture(() => runOp('edit_region', { mask: 'mask', instruction: 'a red umbrella' }));
    expect(ideogram).toMatchObject({ image_url: 'data:image/png;base64,photo', mask_url: 'data:image/png;base64,mask' });
    expect(String(ideogram.prompt)).toMatch(/^a red umbrella\. Change only the masked area/);
    install(['fal::openai/gpt-image-2/edit'], { editRegion: 'fal::openai/gpt-image-2/edit' });
    const gpt = await capture(() => runOp('edit_region', { mask: 'mask', instruction: 'a red umbrella' }));
    expect(gpt.mask_url).toBe('data:image/png;base64,mask-alpha');
  });

  it('removes objects with the dedicated model, or inpainting with an instruction when there is none', async () => {
    install(['fal::fal-ai/ideogram/object-removal', 'fal::fal-ai/qwen-image-edit/inpaint']);
    expect(opModelFor('remove_object')).toEqual({ ref: 'fal::fal-ai/ideogram/object-removal', viaEdit: false });
    const removal = await capture(() => runOp('remove_object', { mask: 'mask' }));
    expect(removal).toMatchObject({ image_url: 'data:image/png;base64,photo', mask_url: 'data:image/png;base64,mask' });
    install(['fal::fal-ai/qwen-image-edit/inpaint']);
    expect(opModelFor('remove_object')).toEqual({ ref: 'fal::fal-ai/qwen-image-edit/inpaint', viaEdit: true });
  });

  it('explains every refusal with a code and sends nothing', async () => {
    const send = vi.fn();
    install(['fal::fal-ai/ideogram/v3/edit']);
    vi.stubGlobal('fetch', send);
    await expect(runOp('edit_region', { instruction: 'x' })).rejects.toThrow(/\[MASK_MISSING\]/);
    install(['fal::fal-ai/ideogram/v3/edit'], {}, [512, 512]);
    vi.stubGlobal('fetch', send);
    await expect(runOp('edit_region', { mask: 'mask', instruction: 'x' })).rejects.toThrow(/\[MASK_SIZE\]/);
    install(['fal::fal-ai/nano-banana-pro/edit'], { editRegion: 'fal::fal-ai/nano-banana-pro/edit' });
    vi.stubGlobal('fetch', send);
    await expect(runOp('edit_region', { mask: 'mask', instruction: 'x' })).rejects.toThrow(/\[MASK_UNSUPPORTED\]/);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps mask operations out of menus, nodes and the agent', async () => {
    expect(opsFor('image').map((o) => o.id)).not.toContain('edit_region');
    expect(AGENT_OP_IDS).not.toContain('remove_object');
    const ctx: PlanContext = { workspace: 'chat', getModel: async () => null, defaultModel: () => null, defaultSettings: () => ({}), asset: () => ({ kind: 'image' }), layer: () => undefined };
    const { errors } = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'op', op: 'edit_region', input: 'asset:photo', params: { instruction: 'x' } }] }, ctx, 'p');
    expect(errors.join(' ')).toMatch(/needs a mask the user paints in Sketch/);
  });
});
