import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import falSnapshot from './fixtures/live/fal.json';
import atlasSnapshot from './fixtures/live/atlas.json';
import { audioInputProblem, routeAudio, schemaFromJson, videoInputProblem, type JsonProp } from '../src/engine/params';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { atlas } from '../src/engine/providers/atlas';
import { useStore } from '../src/store/store';
import type { GenRequest } from '../src/engine/providers/types';
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
function falSchema(id: string, kind: MediaKind): ModelSchema {
  const doc = (falSnapshot as Loose).models.find((m: Loose) => m.endpoint_id === id).schemaDoc;
  const schemas = doc.components.schemas;
  const input = schemas[doc.paths[`/${id}`].post.requestBody.content['application/json'].schema.$ref.split('/').pop()];
  return schemaFromJson({ ref: `fal::${id}`, kind, properties: input.properties as Record<string, JsonProp>, required: input.required ?? [], resolve: (r) => schemas[r.split('/').pop()!], imageFormat: 'data-url', source: 'openapi' });
}
function atlasSchema(id: string): ModelSchema {
  const schemas = (atlasSnapshot as Loose).models.find((m: Loose) => m.model === id).schemaDoc.components.schemas;
  return schemaFromJson({ ref: `atlas::${id}`, kind: 'video', properties: schemas.Input.properties, required: schemas.Input.required ?? [], resolve: (r) => schemas[r.split('/').pop()!], imageFormat: 'url', source: 'openapi' });
}
const LIPSYNC = 'minimax/h3-max/lip-sync/image-to-video';

beforeEach(() => vi.stubGlobal('location', { href: 'http://localhost/' }));
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(globalThis, { window: fakeWindow });
});

describe('audio inputs in live schemas', () => {
  it('reads required speech, optional soundtracks and reference audio lists', () => {
    expect(falSchema(LIPSYNC, 'video').slots.audio).toMatchObject({ key: 'audio_url', required: true });
    expect(falSchema(LIPSYNC, 'video').missing).toBeUndefined();
    expect(falSchema('minimax/h3/image-to-video', 'video').slots.audio).toMatchObject({ key: 'target_audio_url', required: false });
    expect(falSchema('bytedance/seedance-2.5/reference-to-video', 'video').slots.refAudios?.key).toBe('audio_urls');
    expect(atlasSchema('bytedance/seedance-2.0/reference-to-video').slots.refAudios?.key).toBe('reference_audios');
    // generate_audio / audio switches stay settings, not inputs.
    expect(falSchema('minimax/h3/image-to-video', 'video').params.some((p) => p.role === 'audio' || p.key === 'target_audio_url')).toBe(false);
  });
  it('routes the first track to the single field and explains what is missing', () => {
    const lip = falSchema(LIPSYNC, 'video').slots;
    expect(routeAudio(lip, ['a', 'b'])).toEqual({ audio: 'a', refAudios: ['b'] });
    expect(audioInputProblem(lip, 0)).toBe('needs an audio track.');
    expect(audioInputProblem(lip, 2)).toBe('accepts up to 1 audio track.');
    expect(audioInputProblem({}, 1)).toBe('does not accept audio.');
    // MiniMax refers: audio counts among the references but cannot stand alone.
    const refers = atlasSchema('minimax/h3/reference-to-video').slots;
    expect(videoInputProblem(refers, { firstFrame: false, images: 0, videos: 0, audios: 1 })).toMatch(/at least one reference image or video/);
    expect(videoInputProblem(refers, { firstFrame: false, images: 1, videos: 0, audios: 1 })).toBeNull();
  });
});

describe('audio end to end', () => {
  it('sends the image and the speech track to a fal lip-sync model', async () => {
    const ref = `fal::${LIPSYNC}`;
    const asset = (id: string, kind: Asset['kind'], mime: string): Asset => ({ id, kind, mime, width: kind === 'audio' ? 0 : 720, height: kind === 'audio' ? 0 : 1280, duration: kind === 'audio' ? 6 : undefined, sessionId: 's', origin: 'upload', stored: true, favorite: false, createdAt: 0 }) as Asset;
    blobs.set('face', Object.assign(new Blob([new Uint8Array(4)], { type: 'image/png' }), { tag: 'face' }));
    blobs.set('voice', Object.assign(new Blob([new Uint8Array(4)], { type: 'audio/mpeg' }), { tag: 'voice' }));
    const st = useStore.getState();
    useStore.setState({
      assets: { face: asset('face', 'image', 'image/png'), voice: asset('voice', 'audio', 'audio/mpeg') },
      catalog: { ...st.catalog, models: { [ref]: { ref, provider: 'fal', id: LIPSYNC, name: 'Lip-sync', kind: 'video', acceptsText: false, acceptsImage: true, tags: [] } as ModelSummary }, schemas: { [ref]: falSchema(LIPSYNC, 'video') } },
      settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' } },
    });
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://queue.fal.run/')) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ detail: 'stop here' }), { status: 400 });
      }
      throw new Error(`unexpected ${url}`);
    });
    const g = createGeneration({ sessionId: 's', kind: 'video', prompt: '', modelRef: ref, settings: { count: 1, advanced: {} }, inputs: { refs: ['voice'], firstFrame: 'face' }, origin: 'composer' });
    await expect(runGeneration(g.id)).rejects.toThrow('stop here');
    expect(body).toMatchObject({ image_url: 'data:image/png;base64,face', audio_url: 'data:audio/mpeg;base64,voice' });
  });

  it('adds audio to Atlas refers as type audio', async () => {
    vi.stubGlobal('location', { href: 'http://localhost/' });
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      // Uploads run in parallel: name each URL after the uploaded file's type.
      if (url.includes('uploadMedia')) return new Response(JSON.stringify({ data: { download_url: `https://cdn.test/${((init?.body as FormData).get('file') as File).type}` } }));
      if (url.includes('generateVideo')) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ message: 'stop here' }), { status: 400 });
      }
      throw new Error(`unexpected ${url}`);
    });
    const file = (type: string): GenRequest['refs'][number] => ({ assetId: type, blob: new Blob([new Uint8Array(2)], { type }), mime: type, width: 1, height: 1 });
    const schema = atlasSchema('minimax/h3/reference-to-video');
    const req: GenRequest = {
      kind: 'video', model: { ref: 'atlas::m', provider: 'atlas', id: 'minimax/h3/reference-to-video', name: 'm', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] }, schema, prompt: 'x',
      settings: { count: 1, advanced: {} }, count: 1, refs: [file('image/png')], refAudios: [file('audio/mpeg')], apiKey: 'k', signal: new AbortController().signal, onStatus: () => undefined, onRemoteJob: () => undefined,
    };
    await expect(atlas.generate(req)).rejects.toThrow('stop here');
    expect(body.refers).toEqual([{ url: 'https://cdn.test/image/png', type: 'image' }, { url: 'https://cdn.test/audio/mpeg', type: 'audio' }]);
  });
});

describe('agent plans with audio', () => {
  const models: Record<string, { model: ModelSummary; schema: ModelSchema }> = {
    'fal::lip': { model: { ref: 'fal::lip', provider: 'fal', id: LIPSYNC, name: 'Lip', kind: 'video', acceptsText: false, acceptsImage: true, tags: [] }, schema: falSchema(LIPSYNC, 'video') },
    'fal::veo': { model: { ref: 'fal::veo', provider: 'fal', id: 'fal-ai/veo3.1/image-to-video', name: 'Veo', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] }, schema: falSchema('fal-ai/veo3.1/image-to-video', 'video') },
  };
  const ctx: PlanContext = {
    workspace: 'chat',
    getModel: async (r) => models[r] ?? null,
    defaultModel: () => 'fal::veo',
    defaultSettings: () => ({}),
    asset: (id) => (id.startsWith('au') ? { kind: 'audio' } : { kind: 'image' }),
    layer: () => undefined,
  };
  it('accepts speech for a lip-sync model and requires it', async () => {
    const ok = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', model: 'fal::lip', first_frame: 'asset:img', refs: ['asset:au1'] }] }, ctx, 'p');
    expect(ok.errors).toEqual([]);
    const missing = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', model: 'fal::lip', first_frame: 'asset:img' }] }, ctx, 'p');
    expect(missing.errors.join(' ')).toMatch(/needs an audio track/);
    const veo = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'x', model: 'fal::veo', first_frame: 'asset:img', refs: ['asset:au1'] }] }, ctx, 'p');
    expect(veo.errors.join(' ')).toMatch(/does not accept audio/);
  });
});
