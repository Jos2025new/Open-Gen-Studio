import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import atlasSnapshot from './fixtures/live/atlas.json';
import falSnapshot from './fixtures/live/fal.json';
import { clipTrim, placeKeyframes, schemaFromJson, type JsonProp } from '../src/engine/params';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { structuredInputs } from '../src/engine/providers/shared';
import { useStore } from '../src/store/store';
import type { Asset, MediaKind, ModelSchema, ModelSummary } from '../src/engine/types';

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
  blobToDataUrl: async (b: Blob) => `data:${b.type};base64,${(b as Blob & { tag?: string }).tag ?? 'x'}`,
}));

type Loose = any;
const atlasInput = (id: string) => (atlasSnapshot as Loose).models.find((m: Loose) => m.model === id).schemaDoc.components.schemas;
function falSchema(id: string, kind: MediaKind): ModelSchema {
  const doc = (falSnapshot as Loose).models.find((m: Loose) => m.endpoint_id === id).schemaDoc;
  const schemas = doc.components.schemas;
  const input = schemas[doc.paths[`/${id}`].post.requestBody.content['application/json'].schema.$ref.split('/').pop()];
  return schemaFromJson({ ref: `fal::${id}`, kind, properties: input.properties as Record<string, JsonProp>, required: input.required ?? [], resolve: (r) => schemas[r.split('/').pop()!], imageFormat: 'data-url', source: 'openapi' });
}
function atlasSchema(id: string, kind: MediaKind): ModelSchema {
  const schemas = atlasInput(id);
  return schemaFromJson({ ref: `atlas::${id}`, kind, properties: schemas.Input.properties, required: schemas.Input.required ?? [], resolve: (r) => schemas[r.split('/').pop()!], imageFormat: 'url', source: 'openapi' });
}

beforeEach(() => vi.stubGlobal('location', { href: 'http://localhost/' }));
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(globalThis, { window: fakeWindow });
});

describe('keyframe placement (BFL FLUX 3 guide)', () => {
  it('opens with one image, pins start and end with two, spreads three or more evenly', () => {
    expect(placeKeyframes(1, 5, 24)).toEqual([0]);
    expect(placeKeyframes(2, 5, 24)).toEqual([0, 120]);
    expect(placeKeyframes(3, 5, 24)).toEqual([0, 60, 120]);
    expect(placeKeyframes(4, 10, 24)).toEqual([0, 80, 160, 240]);
  });
  it('keeps seconds set by the user, clamped to the clip, and never repeats a frame', () => {
    expect(placeKeyframes(3, 5, 24, [null, 1, null])).toEqual([0, 24, 120]);
    expect(placeKeyframes(2, 5, 24, [9, null])).toEqual([120, 119]);
    expect(new Set(placeKeyframes(3, 5, 24, [2, 2, 2])).size).toBe(3);
  });
});

describe('clip trims', () => {
  it('uses the whole clip where the model allows it and the longest span otherwise', () => {
    const nano = atlasSchema('google/nano-banana-2/reference-to-image', 'image').slots.clips!;
    expect(nano).toMatchObject({ key: 'video_clips', max: 1, min: 1, wholeEnd: 0, fps: { key: 'fps', value: 1 } });
    expect(clipTrim(nano, 40)).toEqual([0, 0]);
    const gemini = atlasSchema('google/gemini-omni-flash/reference-to-video-developer', 'video').slots.clips!;
    expect(gemini).toMatchObject({ maxSpan: 10, integer: true });
    expect(clipTrim(gemini, 25)).toEqual([0, 10]);
    expect(clipTrim(gemini, 6.4)).toEqual([0, 6]);
    expect(clipTrim(gemini, 25, [3.5, 20])).toEqual([3, 14]);
  });
  it('builds the list items from the slot field names', async () => {
    const slots = atlasSchema('google/nano-banana-2/reference-to-image', 'image').slots;
    const clip = { assetId: 'v', blob: new Blob(), mime: 'video/mp4', width: 1, height: 1 };
    const out = await structuredInputs(slots, { clips: [{ input: clip, start: 0, end: 0 }] }, async () => 'img', async () => 'https://cdn.test/v.mp4');
    expect(out).toEqual({ video_clips: [{ url: 'https://cdn.test/v.mp4', start: 0, ends: 0, fps: 1 }] });
  });
});

describe('keyframes end to end (fal FLUX 3)', () => {
  const ref = 'fal::blackforestlabs/flux-3/keyframes-to-video';
  function install() {
    const img = (id: string): Asset => ({ id, kind: 'image', mime: 'image/png', width: 1280, height: 720, sessionId: 's', origin: 'upload', stored: true, favorite: false, createdAt: 0 }) as Asset;
    for (const id of ['k1', 'k2', 'k3']) blobs.set(id, Object.assign(new Blob([new Uint8Array(4)], { type: 'image/png' }), { tag: id }));
    const st = useStore.getState();
    useStore.setState({
      assets: { k1: img('k1'), k2: img('k2'), k3: img('k3') },
      catalog: { ...st.catalog, models: { [ref]: { ref, provider: 'fal', id: ref.slice(5), name: 'FLUX 3 keyframes', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] } as ModelSummary }, schemas: { [ref]: falSchema(ref.slice(5), 'video') } },
      settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' } },
    });
  }

  it('sends every image as a keyframe at its frame index with an explicit duration', async () => {
    install();
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://queue.fal.run/')) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ detail: 'stop here' }), { status: 400 });
      }
      throw new Error(`unexpected ${url}`);
    });
    const g = createGeneration({ sessionId: 's', kind: 'video', prompt: 'a flower opens', modelRef: ref, settings: { count: 1, duration: 10, advanced: {} }, inputs: { refs: ['k1', 'k2', 'k3'], times: { k2: 3 } }, origin: 'composer' });
    await expect(runGeneration(g.id)).rejects.toThrow('stop here');
    expect(body.keyframes).toEqual([
      { image_url: 'data:image/png;base64,k1', frame_index: 0 },
      { image_url: 'data:image/png;base64,k2', frame_index: 72 },
      { image_url: 'data:image/png;base64,k3', frame_index: 240 },
    ]);
    expect(body.duration).toBe(10);
  });
});

describe('agent plans with references and keyframes', () => {
  const flux = atlasSchema('black-forest-labs/flux-3/keyframes-to-video', 'video');
  const veo = atlasSchema('google/veo3.1/image-to-video', 'video');
  const models: Record<string, { model: ModelSummary; schema: ModelSchema }> = {
    'atlas::flux-kf': { model: { ref: 'atlas::flux-kf', provider: 'atlas', id: 'flux-kf', name: 'FLUX 3 KF', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] }, schema: flux },
    'atlas::veo-i2v': { model: { ref: 'atlas::veo-i2v', provider: 'atlas', id: 'veo-i2v', name: 'Veo I2V', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] }, schema: veo },
  };
  const ctx: PlanContext = {
    workspace: 'chat',
    getModel: async (r) => models[r] ?? null,
    defaultModel: () => 'atlas::veo-i2v',
    defaultSettings: () => ({}),
    asset: (id) => (id.startsWith('v') ? { kind: 'video' } : { kind: 'image' }),
    layer: () => undefined,
  };

  it('keeps refs and times for a keyframe model', async () => {
    const { plan, errors } = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'bloom', model: 'atlas::flux-kf', duration: 8, refs: ['asset:a', 'asset:b', 'asset:c'], times: [null, 2, null] }] }, ctx, 'p');
    expect(errors).toEqual([]);
    expect(plan!.steps[0]).toMatchObject({ refs: ['asset:a', 'asset:b', 'asset:c'], times: [null, 2, null] });
  });
  it('rejects inputs the chosen model cannot take, with the same rules as the composer', async () => {
    const { errors } = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'x', model: 'atlas::veo-i2v', refs: ['asset:a', 'asset:b'] }] }, ctx, 'p');
    expect(errors.join(' ')).toMatch(/takes one start image/);
    const video = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'x', model: 'atlas::veo-i2v', refs: ['asset:v1'] }] }, ctx, 'p');
    expect(video.errors.join(' ')).toMatch(/does not accept reference videos/);
  });
});
