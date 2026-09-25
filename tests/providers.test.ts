import { afterEach, describe, expect, it, vi } from 'vitest';
import fixtures from './fixtures/provider-schemas.json';
import imageFixtures from './fixtures/image-schemas.json';
import { coerceSettings, isAutoOption, routeVideoInputs, schemaFromJson, videoInputProblem, wireParams, type JsonProp } from '../src/engine/params';
import { atlas, atlasVideoCaps } from '../src/engine/providers/atlas';
import { fal } from '../src/engine/providers/fal';
import { nanogpt } from '../src/engine/providers/nanogpt';
import { splitSource } from '../src/engine/providers/shared';
import type { GenRequest, MediaInput } from '../src/engine/providers/types';
import type { ModelSchema, ModelSummary } from '../src/engine/types';

// Provider modules cache catalogs in IndexedDB, which node lacks.
vi.mock('../src/lib/idb', () => ({ cacheDb: { get: async () => undefined, set: async () => undefined } }));

// Trimmed from the live Atlas / fal / NanoGPT schemas (2026-09-24), see MODEL_VALIDATION.md.
const fx = fixtures as unknown as Record<'minimaxRef' | 'wanRef' | 'seedanceRef' | 'falH3Max', { properties: Record<string, JsonProp>; required: string[] }> & { nano: unknown[] };

const parse = (f: { properties: Record<string, JsonProp>; required: string[] }, ref = 'atlas::test') =>
  schemaFromJson({ ref, kind: 'video', properties: f.properties, required: f.required, resolve: () => undefined, imageFormat: 'url', source: 'openapi' });

afterEach(() => vi.unstubAllGlobals());

describe('reference inputs in live schemas', () => {
  it('reads Atlas refers as one list of typed references', () => {
    expect(parse(fx.minimaxRef).slots.mixedRefs).toEqual({ key: 'refers', max: 9, min: 1 });
    expect(parse(fx.wanRef).slots.mixedRefs).toEqual({ key: 'refers', max: 20, min: 0 });
  });
  it('reads reference videos next to reference images and hides disabled options', () => {
    const s = parse(fx.seedanceRef);
    expect(s.slots.images?.key).toBe('reference_images');
    expect(s.slots.refVideos).toMatchObject({ key: 'reference_videos', max: 10, min: 0 });
    expect(s.params.map((p) => p.key)).not.toContain('omni_reference_task_type');
  });
  it('always sends a required field the UI does not show (fal prompt_expansion_mode)', () => {
    const s = parse(fx.falH3Max, 'fal::minimax/h3-max/text-to-video');
    expect(s.fixed).toEqual({ prompt_expansion_mode: 'balanced' });
    expect(wireParams(s, { count: 1, advanced: {} }, 1)).toMatchObject({ prompt_expansion_mode: 'balanced' });
  });
});

describe('video input routing', () => {
  const i2v = { firstFrame: { key: 'image', format: 'url' as const } };
  const refs = { images: { key: 'images', max: 3, min: 1, multiple: true, format: 'url' as const } };
  it('uses the first image as start frame and the rest as references', () => {
    expect(routeVideoInputs({ ...i2v, ...refs }, ['a', 'b'], [])).toEqual({ firstFrame: 'a', images: ['b'], videos: [] });
  });
  it('turns a start frame into a reference when the model has no start frame', () => {
    const r = routeVideoInputs(refs, [], [], 'a');
    expect(r).toEqual({ firstFrame: undefined, images: ['a'], videos: [] });
    expect(videoInputProblem(refs, { firstFrame: false, images: 1, videos: 0 })).toBeNull();
  });
  it('explains what a model cannot take', () => {
    expect(videoInputProblem(i2v, { firstFrame: true, images: 1, videos: 0 })).toBe('takes one start image.');
    expect(videoInputProblem(refs, { firstFrame: false, images: 0, videos: 0 })).toBe('needs a reference image.');
    expect(videoInputProblem(i2v, { firstFrame: false, images: 0, videos: 1 })).toMatch(/does not accept reference videos/);
    expect(videoInputProblem({ mixedRefs: { key: 'refers', max: 9, min: 1 } }, { firstFrame: false, images: 0, videos: 0 })).toMatch(/needs at least one/);
  });
});

describe('model classification', () => {
  it('reads the Atlas task from the endpoint name when the category is missing or wrong', () => {
    expect(atlasVideoCaps('black-forest-labs/flux-3/text-to-video', [])).toEqual({ text: true, image: false, video: false });
    expect(atlasVideoCaps('alibaba/wan-3.0/reference-to-video', ['VIDEO-TO-VIDEO'])).toEqual({ text: true, image: true, video: false });
    expect(atlasVideoCaps('xai/grok-imagine-video/extend-video', ['IMAGE-TO-VIDEO'])?.video).toBe(true);
    expect(atlasVideoCaps('google/gemini-omni-flash/image-to-video-developer', ['IMAGE-TO-VIDEO'])?.image).toBe(true);
    expect(atlasVideoCaps('black-forest-labs/flux-3/keyframes-to-video', [])).toBeNull();
    expect(atlasVideoCaps('google/gemini-omni-flash/reference-to-video-developer', ['VIDEO-TO-VIDEO'])).toBeNull();
  });

  it('keeps NanoGPT multi-mode models in the normal pickers and wires their references', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify({ data: url.includes('video-models') ? fx.nano : [] })));
    const models = await nanogpt.listModels(undefined);
    const by = (id: string) => models.find((m) => m.id === id)!;
    expect(by('bytedance/seedance-2.5')).toMatchObject({ acceptsImage: true, acceptsVideo: true, needsVideo: false });
    expect(by('alibaba/wan-3.0/video-edit')).toMatchObject({ acceptsImage: false, needsVideo: true });

    const seedance = await nanogpt.loadSchema(by('bytedance/seedance-2.5'), undefined);
    expect(seedance.slots.firstFrame?.key).toBe('imageDataUrl');
    expect(seedance.slots.video?.key).toBe('videoDataUrl');
    const ref = await nanogpt.loadSchema(by('minimax-h3/reference-to-video'), undefined);
    expect(ref.slots.firstFrame).toBeUndefined();
    expect(ref.slots.images).toMatchObject({ key: 'referenceImages', max: 9 });
    expect(ref.slots.refVideos).toMatchObject({ key: 'referenceVideos', max: 3 });
    const seedance20 = await nanogpt.loadSchema(by('bytedance-seedance-2-0'), undefined);
    expect(seedance20.slots.lastFrame?.key).toBe('last_image');
  });
});

describe('request payloads', () => {
  const clip = (size = 10): MediaInput => ({ assetId: 'v', blob: new Blob([new Uint8Array(size)], { type: 'video/mp4' }), mime: 'video/mp4', width: 1280, height: 720 });
  const request = (model: Partial<ModelSummary>, schema: ModelSchema, extra: Partial<GenRequest>): GenRequest => ({
    kind: 'video',
    model: { ref: 'x', provider: 'atlas', id: 'x', name: 'x', kind: 'video', acceptsText: true, acceptsImage: true, tags: [], ...model },
    schema,
    prompt: 'A horse',
    settings: { count: 1, advanced: {} },
    count: 1,
    refs: [],
    apiKey: 'k',
    signal: new AbortController().signal,
    onStatus: () => undefined,
    onRemoteJob: () => undefined,
    ...extra,
  });

  it('sends Atlas refers as uploaded { url, type } items', async () => {
    vi.stubGlobal('location', { href: 'http://localhost/' });
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('uploadMedia')) return new Response(JSON.stringify({ data: { download_url: 'https://cdn.test/ref.mp4' } }));
      if (url.includes('generateVideo')) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ data: { id: 'p1' } }));
      }
      if (url.includes('prediction')) return new Response(JSON.stringify({ data: { status: 'completed', outputs: ['https://cdn.test/out.mp4'] } }));
      return new Response(new Blob([new Uint8Array(4)], { type: 'video/mp4' }));
    });
    await atlas.generate(request({ id: 'alibaba/wan-3.0/reference-to-video' }, parse(fx.wanRef), { refVideos: [clip()] }));
    expect(body.refers).toEqual([{ url: 'https://cdn.test/ref.mp4', type: 'video' }]);
    expect(body.model).toBe('alibaba/wan-3.0/reference-to-video');
  });

  it('refuses NanoGPT source videos over 4 MB before sending anything', async () => {
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    const schema: ModelSchema = { ref: 'nanogpt::e', params: [], slots: { prompt: 'prompt', video: { key: 'videoDataUrl', format: 'data-url' } }, source: 'catalog' };
    await expect(nanogpt.generate(request({ provider: 'nanogpt' }, schema, { video: clip(5 * 1024 * 1024) }))).rejects.toThrow(/up to 4 MB/);
    expect(send).not.toHaveBeenCalled();
  });
});

// Image families (GPT Image, Seedream V5, Qwen, Z-Image, Ideogram, P Image…), trimmed from live schemas 2026-09-24.
describe('image schemas', () => {
  type Fx = { properties: Record<string, JsonProp>; required: string[] };
  const img = imageFixtures as unknown as Record<string, Fx> & { nanoImage: unknown[] };
  const parseImage = (f: Fx) => schemaFromJson({ ref: 'atlas::i', kind: 'image', properties: f.properties, required: f.required, resolve: () => undefined, imageFormat: 'url', source: 'openapi' });

  it('turns a list of pixel sizes into the framing control and keeps its scale', () => {
    const s = parseImage(img.atlasGptImage2);
    expect(s.params.find((p) => p.key === 'size')?.role).toBe('aspect');
    const { settings } = coerceSettings(s, 'image', { aspect: '16:9', count: 1 });
    expect(settings.aspect).toBe('2048x1152');
    expect(wireParams(s, settings, 1).size).toBe('2048x1152');
  });
  it('offers sizes for a free "width*height" field, with an unsent Auto when the model may choose', () => {
    const qwen = parseImage(img.atlasQwen3Edit).params.find((p) => p.key === 'size')!;
    expect(qwen).toMatchObject({ role: 'aspect', omit: 'auto', default: 'auto' });
    expect(qwen.options).toContain('1440*816');
    expect(wireParams(parseImage(img.atlasQwen3Edit), { aspect: 'auto', count: 1, advanced: {} }, 1)).not.toHaveProperty('size');
    const z = parseImage(img.atlasZImage).params.find((p) => p.key === 'size')!;
    expect(z.default).toBe('1024*1536');
    expect(z.options).toContain('1536*864');
  });
  it('sends the source image to the required field and names inputs the app cannot send', () => {
    expect(parseImage(img.falIdeogramRemix).slots.images).toMatchObject({ key: 'image_url', min: 1, multiple: false });
    expect(parseImage(img.falIdeogramCharacter).slots.images).toMatchObject({ key: 'reference_image_urls', min: 1 });
    expect(parseImage(img.falIdeogramEdit).missing).toEqual(['mask_url']);
  });
  it('reads NanoGPT framing and image inputs from the catalog', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify({ data: url.includes('images/models') ? img.nanoImage : [] })));
    const models = await nanogpt.listModels(undefined);
    const schema = (id: string) => nanogpt.loadSchema(models.find((m) => m.id === id)!, undefined);
    // Seedream V5 Pro mixes ratios and tiers in `resolution`: it is the framing control.
    expect((await schema('bytedance/seedream-v5.0-pro')).params.find((p) => p.key === 'resolution')?.role).toBe('aspect');
    // A text-only endpoint that declares max_input_images takes no images.
    expect((await schema('openai/gpt-image-2.5/flare/text-to-image')).slots.images).toBeUndefined();
    expect(isAutoOption('match_input_image')).toBe(true);
  });
  it('sends the first image as source and the rest as references (Ideogram Character remix)', () => {
    const img = (id: string) => ({ assetId: id, blob: new Blob(), mime: 'image/png', width: 1, height: 1 });
    const slots = { source: { key: 'image_url', format: 'data-url' as const }, images: { key: 'reference_image_urls', max: 10, min: 1, multiple: true, format: 'data-url' as const } };
    const r = splitSource(slots, [img('a'), img('b'), img('c')]);
    expect(r.source?.assetId).toBe('a');
    expect(r.refs.map((x) => x.assetId)).toEqual(['b', 'c']);
    expect(splitSource({ images: slots.images }, [img('a')]).refs).toHaveLength(1);
  });
});

describe('fal catalog listing', () => {
  it('backs off on 429 and retries without a rejected key', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { href: 'http://localhost/' });
    const seen: Array<{ category: string | null; auth: boolean }> = [];
    let limited = true;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const auth = Boolean((init?.headers as Record<string, string> | undefined)?.Authorization);
      seen.push({ category: new URL(url).searchParams.get('category'), auth });
      if (auth) return new Response('{"detail":"bad key"}', { status: 401 });
      if (limited) {
        limited = false;
        return new Response('{"detail":"Too Many Requests"}', { status: 429 });
      }
      return new Response(JSON.stringify({ models: [{ endpoint_id: `x/${new URL(url).searchParams.get('category')}`, metadata: {} }], has_more: false }));
    });
    const listing = fal.listModels('bad-key');
    await vi.runAllTimersAsync();
    const models = await listing;
    vi.useRealTimers();
    expect(models).toHaveLength(5);
    expect(seen.filter((r) => r.category === 'text-to-image').map((r) => r.auth)).toEqual([true, false, false]);
  });
});
