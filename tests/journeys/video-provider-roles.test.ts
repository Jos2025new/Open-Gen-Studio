import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('fetch', async (input: unknown) => { throw new Error(`Blocked request before journey imports: ${String(input)}`); });
});
import atlasSnapshot from '../fixtures/live/atlas.json';
import falSnapshot from '../fixtures/live/fal.json';
import { createGeneration, runGeneration } from '../../src/engine/jobs';
import { schemaFromJson, type JsonProp } from '../../src/engine/params';
import { useStore } from '../../src/store/store';
import type { Asset, ModelSchema, ModelSummary } from '../../src/engine/types';

const blobs = vi.hoisted(() => new Map<string, Blob>());
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async (id: string) => blobs.get(id), putAssetBlob: async () => undefined,
}));
vi.mock('../../src/lib/media', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/media')>();
  return {
    ...original,
    prepareImageForUpload: async (blob: Blob) => blob,
    blobToDataUrl: async (blob: Blob) => `data:${blob.type};base64,${(blob as Blob & { journeyTag?: string }).journeyTag ?? 'image'}`,
  };
});

type Loose = any;
const atlasData = atlasSnapshot as Loose;
const falData = falSnapshot as Loose;
function atlasSchema(id: string): ModelSchema {
  const schemas = atlasData.models.find((m: Loose) => m.model === id).schemaDoc.components.schemas;
  return schemaFromJson({ ref: `atlas::${id}`, kind: 'video', properties: schemas.Input.properties, required: schemas.Input.required ?? [], resolve: (ref) => schemas[ref.split('/').pop()!], imageFormat: 'url', source: 'openapi' });
}
function falSchema(id: string): ModelSchema {
  const doc = falData.models.find((m: Loose) => m.endpoint_id === id).schemaDoc;
  const schemas = doc.components.schemas;
  const ref = doc.paths[`/${id}`].post.requestBody.content['application/json'].schema.$ref;
  const input = schemas[ref.split('/').pop()!];
  return schemaFromJson({ ref: `fal::${id}`, kind: 'video', properties: input.properties as Record<string, JsonProp>, required: input.required ?? [], resolve: (r) => schemas[r.split('/').pop()!], imageFormat: 'data-url', source: 'openapi' });
}
const image = (id: string): Asset => ({ id, kind: 'image', mime: 'image/png', width: 1280, height: 720, sessionId: 'video-test', origin: 'upload', stored: true, favorite: false, createdAt: 0 }) as Asset;
const refs = {
  startEnd: 'google/veo3.1/image-to-video',
  references: 'google/veo3.1/reference-to-video',
  keyframes: 'blackforestlabs/flux-3/keyframes-to-video',
};
let sent: Array<{ url: string; body: Record<string, unknown> }> = [];
let blocked: string[] = [];
let uploads = 0;

function setup(kind: 'startEnd' | 'references' | 'keyframes') {
  vi.stubGlobal('location', { href: 'http://localhost/' });
  sent = [];
  blocked = [];
  uploads = 0;
  blobs.clear();
  const ids = ['start', 'end', 'ref1', 'ref2', 'key1', 'key2'];
  ids.forEach((id) => blobs.set(id, Object.assign(new Blob([id], { type: 'image/png' }), { journeyTag: id })));
  const st = useStore.getState();
  const id = refs[kind];
  const provider = kind === 'keyframes' ? 'fal' : 'atlas';
  const modelRef = `${provider}::${id}`;
  const schema = kind === 'keyframes' ? falSchema(id) : atlasSchema(id);
  const model: ModelSummary = { ref: modelRef, provider, id, name: id, kind: 'video', acceptsText: true, acceptsImage: true, tags: [] };
  useStore.setState({
    assets: Object.fromEntries(ids.map((assetId) => [assetId, image(assetId)])),
    catalog: { ...st.catalog, models: { [modelRef]: model }, schemas: { [modelRef]: schema }, status: { ...st.catalog.status, [provider]: 'ready' } },
    settings: { ...st.settings, keys: { ...st.settings.keys, [provider]: 'test-only' } },
  });
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/v1/model/uploadMedia')) {
      uploads += 1;
      return new Response(JSON.stringify({ data: { url: `https://simulated.invalid/upload-${uploads}.png` } }));
    }
    if (url === `https://api.atlascloud.ai/api/v1/model/generateVideo` || url === `https://queue.fal.run/${id}`) {
      sent.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      throw new Error('simulation stops at provider submission');
    }
    blocked.push(url);
    throw new Error(`Blocked unapproved video journey request: ${url}`);
  });
  return { sessionId: st.activeSessionId, modelRef };
}

afterEach(async () => { await (await import('../../src/lib/log')).logSettled(); vi.unstubAllGlobals(); blobs.clear(); });

async function submit(kind: 'startEnd' | 'references' | 'keyframes', inputs: { refs: string[]; firstFrame?: string; lastFrame?: string; times?: Record<string, number> }) {
  const { sessionId, modelRef } = setup(kind);
  const g = createGeneration({ sessionId, kind: 'video', prompt: 'journey scene', modelRef, settings: { count: 1, duration: 8, advanced: {} }, inputs, origin: 'composer' });
  await expect(runGeneration(g.id)).rejects.toThrow();
  expect(sent, `blocked requests: ${blocked.join(', ')}`).toHaveLength(1);
  expect(blocked.every((url) => url === 'https://api.atlascloud.ai/api/v1/model/calculate' || url === '/x/store/log')).toBe(true);
  return sent[0].body;
}

describe('video input roles at the provider request boundary', () => {
  it('sends explicit start and end images in the real Veo schema fields', async () => {
    const body = await submit('startEnd', { refs: [], firstFrame: 'start', lastFrame: 'end' });
    expect(body.image).toBe('https://simulated.invalid/upload-1.png');
    expect(body.last_image).toBe('https://simulated.invalid/upload-2.png');
    expect(body.images).toBeUndefined();
    expect(body.keyframes).toBeUndefined();
  });

  it('sends reference images in the reference list, distinct from start/end fields', async () => {
    const body = await submit('references', { refs: ['ref1', 'ref2'] });
    expect(body.images).toEqual(['https://simulated.invalid/upload-1.png', 'https://simulated.invalid/upload-2.png']);
    expect(body.image).toBeUndefined();
    expect(body.last_image).toBeUndefined();
    expect(body.keyframes).toBeUndefined();
  });

  it('sends FLUX 3 keyframes with provider-declared frame indexes, not reference or start/end slots', async () => {
    const body = await submit('keyframes', { refs: ['key1', 'key2'], times: { key2: 4 } });
    expect(body.keyframes).toEqual([
      { image_url: 'data:image/png;base64,key1', frame_index: 0 },
      { image_url: 'data:image/png;base64,key2', frame_index: 96 },
    ]);
    expect(body.images).toBeUndefined();
    expect(body.image).toBeUndefined();
    expect(body.last_image).toBeUndefined();
  });
});
