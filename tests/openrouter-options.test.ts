import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));

const cache = new Map<string, unknown>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async (k: string) => cache.get(k), set: async (k: string, v: unknown) => void cache.set(k, v) },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
vi.mock('../src/engine/providers/shared', async (load) => {
  const actual = await load<typeof import('../src/engine/providers/shared')>();
  return {
    ...actual,
    encodeImage: async (media: { assetId: string }) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${media.assetId}` } }),
    encodeVideo: async (media: { assetId: string }) => `data:application/octet-stream;base64,${media.assetId}`,
  };
});

import { openrouter } from '../src/engine/providers/openrouter';
import type { GenRequest, MediaInput } from '../src/engine/providers/types';
import type { ModelSummary } from '../src/engine/types';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const imageModel = (id: string): ModelSummary => ({ ref: `openrouter::${id}`, provider: 'openrouter', id, name: id, kind: 'image', acceptsText: true, acceptsImage: true, tags: [] });
const baseRequest = (model: ModelSummary, schema: Awaited<ReturnType<typeof openrouter.loadSchema>>): GenRequest => ({
  kind: 'image', model, schema, prompt: 'a test image', settings: { count: 1, advanced: {} }, count: 1, refs: [], apiKey: 'test', signal: new AbortController().signal,
  onStatus: () => undefined, onRemoteJob: () => undefined,
});
const videoModel = (id: string): ModelSummary => ({ ref: `openrouter::${id}`, provider: 'openrouter', id, name: id, kind: 'video', acceptsText: true, acceptsImage: true, tags: [] });
const media = (assetId: string): MediaInput => ({ assetId, blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 1, height: 1 });
const videoRequest = (id: string, schema: Awaited<ReturnType<typeof openrouter.loadSchema>>): GenRequest => ({
  kind: 'video', model: videoModel(id), schema, prompt: 'make a clip', settings: { count: 1, advanced: {} }, count: 1, refs: [media('image-ref')], apiKey: 'test', signal: new AbortController().signal,
  onStatus: () => undefined, onRemoteJob: () => undefined,
});

function route(modelId: string, endpoints: unknown) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/images/models')) return json({ data: [{ id: modelId, name: modelId, architecture: { input_modalities: ['text'], output_modalities: ['image'] }, supported_parameters: { aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] }, resolution: { type: 'enum', values: ['1K', '2K'] } } }] });
    if (url.endsWith('/videos/models')) return json({ data: [] });
    if (url.endsWith(`/images/models/${modelId}/endpoints`)) return json(endpoints);
    if (url.endsWith('/images')) return json({ data: [{ url: 'https://example.test/image.png' }], usage: { cost: 0.01 } });
    throw new Error(`unexpected ${url}`);
  });
}

beforeEach(() => { cache.clear(); vi.unstubAllGlobals(); });

describe('OpenRouter endpoint-aware image options (F3.1-F3.2)', () => {
  it('keeps only capability values common to every endpoint', async () => {
    const id = 'openai/gpt-image-2';
    route(id, { endpoints: [{ supported_parameters: {
      aspect_ratio: { type: 'enum', values: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', 'auto'] },
      quality: { type: 'enum', values: ['auto', 'low', 'medium', 'high'] },
      n: { type: 'range', min: 1, max: 10 },
    } }] });
    const schema = await openrouter.loadSchema(imageModel(id), 'test');
    expect(schema.params.find((p) => p.key === 'aspect_ratio')?.options).toContain('21:9');
    expect(schema.params.find((p) => p.key === 'quality')?.options).toEqual(['auto', 'low', 'medium', 'high']);
  });

  it('intersects endpoint capabilities when providers differ', async () => {
    const id = 'google/gemini-3-pro-image';
    route(id, { endpoints: [
      { supported_parameters: { aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] }, resolution: { type: 'enum', values: ['1K', '2K'] } } },
      { supported_parameters: { aspect_ratio: { type: 'enum', values: ['1:1', '9:16'] }, resolution: { type: 'enum', values: ['1K'] } } },
    ] });
    const schema = await openrouter.loadSchema(imageModel(id), 'test');
    expect(schema.params.find((p) => p.key === 'aspect_ratio')?.options).toEqual(['1:1']);
    expect(schema.params.find((p) => p.key === 'resolution')?.options).toEqual(['1K']);
  });

  it('intersects numeric ranges so each selected value is accepted by every endpoint', async () => {
    const id = 'google/gemini-3-pro-image';
    route(id, { endpoints: [
      { supported_parameters: { n: { type: 'range', min: 1, max: 10 } } },
      { supported_parameters: { n: { type: 'range', min: 2, max: 4 } } },
    ] });
    const schema = await openrouter.loadSchema(imageModel(id), 'test');
    expect(schema.params.find((p) => p.key === 'n')).toMatchObject({ min: 2, max: 4 });
  });

  it('sends only documented passthrough values under each provider slug', async () => {
    const id = 'recraft/recraft-v4';
    route(id, { endpoints: [{ provider_slug: 'recraft', allowed_passthrough_parameters: ['style', 'controls', 'text_layout'] }] });
    const model = imageModel(id);
    const schema = await openrouter.loadSchema(model, 'test');
    let sent: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/images/models')) return json({ data: [{ id, name: id, architecture: { input_modalities: ['text'], output_modalities: ['image'] }, supported_parameters: {} }] });
      if (url.endsWith('/videos/models')) return json({ data: [] });
      if (url.endsWith(`/images/models/${id}/endpoints`)) return json({ endpoints: [{ provider_slug: 'recraft', allowed_passthrough_parameters: ['style', 'controls', 'text_layout'] }] });
      if (url.endsWith('/images')) { sent = JSON.parse(String(init?.body)); return json({ data: [{ url: 'https://example.test/image.png' }] }); }
      throw new Error(`unexpected ${url}`);
    });
    await openrouter.generate({ ...baseRequest(model, schema), settings: { count: 1, advanced: { style: 'realistic' }, extras: { controls: { colors: ['red'] }, text_layout: { layout: 'tight' }, invented: true } } });
    expect(sent?.provider).toEqual({ options: { recraft: { style: 'realistic', controls: { colors: ['red'] }, text_layout: { layout: 'tight' } } } });
    sent = undefined;
    await openrouter.generate({ ...baseRequest(model, schema), settings: { count: 1, advanced: {}, extras: { text_layout: 'arbitrary text', controls: 'arbitrary text' } } });
    expect(sent).not.toHaveProperty('provider');
  });

  it('sends GPT Image moderation only when its endpoint allowlist names it', async () => {
    const id = 'openai/gpt-image-2';
    const model = imageModel(id);
    route(id, { endpoints: [{ provider_slug: 'openai', allowed_passthrough_parameters: ['moderation'] }] });
    const schema = await openrouter.loadSchema(model, 'test');
    let sent: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/images/models')) return json({ data: [{ id, name: id, architecture: { input_modalities: ['text'], output_modalities: ['image'] }, supported_parameters: {} }] });
      if (url.endsWith('/videos/models')) return json({ data: [] });
      if (url.endsWith(`/images/models/${id}/endpoints`)) return json({ endpoints: [{ provider_slug: 'openai', allowed_passthrough_parameters: ['moderation'] }] });
      if (url.endsWith('/images')) { sent = JSON.parse(String(init?.body)); return json({ data: [{ url: 'https://example.test/image.png' }] }); }
      throw new Error(`unexpected ${url}`);
    });
    await openrouter.generate({ ...baseRequest(model, schema), settings: { count: 1, advanced: { moderation: 'low' }, extras: { invented: true } } });
    expect(sent?.provider).toEqual({ options: { openai: { moderation: 'low' } } });
  });

  it('keeps separate passthrough sets for every endpoint slug', async () => {
    const id = 'google/gemini-3-pro-image';
    route(id, { endpoints: [
      { provider_slug: 'google-ai-studio/global', allowed_passthrough_parameters: ['cachedContent'] },
      { provider_slug: 'google-vertex/global', allowed_passthrough_parameters: ['cachedContent'] },
    ] });
    const model = imageModel(id);
    const schema = await openrouter.loadSchema(model, 'test');
    let sent: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/images/models')) return json({ data: [{ id, name: id, architecture: { input_modalities: ['text'], output_modalities: ['image'] }, supported_parameters: {} }] });
      if (url.endsWith('/videos/models')) return json({ data: [] });
      if (url.endsWith(`/images/models/${id}/endpoints`)) return json({ endpoints: [
        { provider_slug: 'google-ai-studio/global', allowed_passthrough_parameters: ['cachedContent'] },
        { provider_slug: 'google-vertex/global', allowed_passthrough_parameters: ['cachedContent'] },
      ] });
      if (url.endsWith('/images')) { sent = JSON.parse(String(init?.body)); return json({ data: [{ url: 'https://example.test/image.png' }] }); }
      throw new Error(`unexpected ${url}`);
    });
    await openrouter.generate({ ...baseRequest(model, schema), settings: { count: 1, advanced: {}, extras: { cachedContent: 'cache-id', safetySetting: { threshold: 'block' }, invented: true } } });
    expect(sent?.provider).toEqual({ options: {
      'google-ai-studio/global': { cachedContent: 'cache-id' },
      'google-vertex/global': { cachedContent: 'cache-id' },
    } });
  });
});

describe('OpenRouter video provider options and multimodal references (F3.3-F3.4)', () => {
  beforeEach(() => { cache.clear(); vi.unstubAllGlobals(); });

  it('sends Veo options under the documented google-vertex slug, filtered by the catalog allowlist', async () => {
    const veo = { id: 'google/veo-3.1', name: 'Google: Veo 3.1', description: 'Text-to-video', supported_resolutions: ['720p'], supported_aspect_ratios: ['16:9'], supported_durations: [4], supported_frame_images: null, generate_audio: null, seed: null, allowed_passthrough_parameters: ['personGeneration', 'aspectRatio', 'negativePrompt', 'conditioningScale', 'enhancePrompt'] };
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/images/models')) return json({ data: [] });
      if (url.endsWith('/videos/models')) return json({ data: [veo] });
      throw new Error(`unexpected ${url}`);
    });
    const listed = await openrouter.listModels('test');
    const schema = await openrouter.loadSchema(listed.find((row) => row.id === veo.id)!, 'test');
    let sent: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/videos')) { sent = JSON.parse(String(init?.body)); return json({ id: 'veo-job', status: 'pending' }); }
      if (url.endsWith('/videos/veo-job')) return json({ status: 'failed', error: 'stop test' });
      throw new Error(`unexpected ${url}`);
    });
    const request = videoRequest(veo.id, schema);
    request.settings = { count: 1, advanced: {}, extras: { personGeneration: 'allow_adult', negativePrompt: 'blur', invented: true } };
    await expect(openrouter.generate(request)).rejects.toThrow('stop test');
    // Cookbook: https://openrouter.ai/docs/cookbook/video-generation/provider-specific-video-options
    expect(sent?.provider).toEqual({ options: { 'google-vertex': { parameters: { personGeneration: 'allow_adult', negativePrompt: 'blur' } } } });
  });

  it('sends Mini image, video, and audio references as OpenRouter input_references', async () => {
    const mini = { id: 'bytedance/seedance-2.0-mini', name: 'ByteDance: Seedance 2.0 Mini', description: 'Seedance 2.0 Mini is a video generation model from ByteDance. It supports text-to-video, image-to-video with first and last frame control, and multimodal reference-to-video with image, video, and audio inputs. It...', supported_resolutions: ['480p'], supported_aspect_ratios: null, supported_durations: [4], supported_frame_images: ['first_frame', 'last_frame'], generate_audio: null, seed: null };
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/images/models')) return json({ data: [] });
      if (url.endsWith('/videos/models')) return json({ data: [mini] });
      throw new Error(`unexpected ${url}`);
    });
    const listed = await openrouter.listModels('test');
    const schema = await openrouter.loadSchema(listed.find((row) => row.id === mini.id)!, 'test');
    let sent: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/videos')) { sent = JSON.parse(String(init?.body)); return json({ id: 'job-media', status: 'pending' }); }
      if (url.endsWith('/videos/job-media')) return json({ status: 'failed', error: 'stop test' });
      throw new Error(`unexpected ${url}`);
    });
    const request = videoRequest(mini.id, schema);
    request.refVideos = [media('video-ref')];
    request.refAudios = [media('audio-ref')];
    await expect(openrouter.generate(request)).rejects.toThrow('stop test');
    // OpenAPI: https://openrouter.ai/docs/api/api-reference/video-generation/create-videos
    expect(sent?.input_references).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,image-ref' } },
      { type: 'video_url', video_url: { url: 'data:application/octet-stream;base64,video-ref' } },
      { type: 'audio_url', audio_url: { url: 'data:application/octet-stream;base64,audio-ref' } },
    ]);
    expect(sent).not.toHaveProperty('frame_images');
  });
});
