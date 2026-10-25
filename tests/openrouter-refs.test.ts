import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));

const cache = new Map<string, unknown>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async (k: string) => cache.get(k), set: async (k: string, v: unknown) => void cache.set(k, v) },
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
import type { ModelSummary, RemoteJob } from '../src/engine/types';
import { REFERENCE_PROTOCOLS } from '../src/engine/modelRules';
import { refMentionStyle, routeVideoInputs, videoInputProblem } from '../src/engine/params';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const seedanceIds = [
  'bytedance/seedance-2.0',
  'bytedance/seedance-2.0-fast',
  'bytedance/seedance-2.0-mini',
  'bytedance/seedance-2.5',
  'alibaba/wan-3.0',
];
const videoRows = [
  { id: 'bytedance/seedance-2.0', name: 'ByteDance: Seedance 2.0', description: 'Seedance 2.0 is a video generation model from ByteDance. It supports text-to-video, image-to-video with first and last frame control, and multimodal reference-to-video. It is particularly strong at preserving character consistency,...', supported_resolutions: ['480p'], supported_aspect_ratios: null, supported_durations: [4], supported_frame_images: null, generate_audio: null, seed: null },
  { id: 'bytedance/seedance-2.0-fast', name: 'ByteDance: Seedance 2.0 Fast', description: 'Seedance 2.0 Fast is a video generation model from ByteDance. It supports text-to-video, image-to-video with first and last frame control, and multimodal reference-to-video. It prioritizes generation speed and lower cost...', supported_resolutions: ['480p'], supported_aspect_ratios: null, supported_durations: [4], supported_frame_images: null, generate_audio: null, seed: null },
  { id: 'bytedance/seedance-2.0-mini', name: 'ByteDance: Seedance 2.0 Mini', description: 'Seedance 2.0 Mini is a video generation model from ByteDance. It supports text-to-video, image-to-video with first and last frame control, and multimodal reference-to-video with image, video, and audio inputs. It...', supported_resolutions: ['480p'], supported_aspect_ratios: null, supported_durations: [4], supported_frame_images: ['first_frame', 'last_frame'], generate_audio: null, seed: null },
  { id: 'bytedance/seedance-2.5', name: 'ByteDance: Seedance 2.5', description: 'Seedance 2.5 is a video generation model from ByteDance. It is suited for long-form storytelling, multimodal reference-based generation, video editing, and video extension. It supports first-frame and first-and-last-frame control, up...', supported_resolutions: ['480p'], supported_aspect_ratios: null, supported_durations: [4], supported_frame_images: null, generate_audio: null, seed: null },
  { id: 'alibaba/wan-3.0', name: 'Alibaba: Wan 3.0', description: 'Wan 3.0 is a video generation model from Alibaba for text-to-video, image-to-video, and reference-guided video generation. It produces 480p, 720p, or 1080p video with durations from 2 to 30 seconds.', supported_resolutions: ['480p'], supported_aspect_ratios: null, supported_durations: [4], supported_frame_images: null, generate_audio: null, seed: null },
  { id: 'alibaba/wan-3.0-prime', name: 'Alibaba: Wan 3.0 Prime', description: 'Wan 3.0 Prime is a fast-mode variant of [Wan 3.0](https://openrouter.ai/alibaba/wan-3.0) from Alibaba. It supports text-to-video and first-frame image-to-video generation.', supported_resolutions: ['480p'], supported_aspect_ratios: null, supported_durations: [4], supported_frame_images: ['first_frame'], generate_audio: null, seed: null },
];
const model = (id: string): ModelSummary => ({ ref: `openrouter::${id}`, provider: 'openrouter', id, name: id, kind: 'video', acceptsText: true, acceptsImage: true, tags: [] });
const media = (assetId: string): MediaInput => ({ assetId, blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 1, height: 1 });
const videoRequest = (id: string, schema: Awaited<ReturnType<typeof openrouter.loadSchema>>, frames: { firstFrame?: MediaInput; lastFrame?: MediaInput } = {}): GenRequest => ({
  kind: 'video', model: model(id), schema, prompt: 'make a clip', settings: { count: 1, advanced: {} }, count: 1, refs: [media('storyboard'), media('character')], apiKey: 'test', signal: new AbortController().signal,
  onStatus: () => undefined, onRemoteJob: () => undefined, ...frames,
});

function catalogFetch() {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/images/models')) return json({ data: [] });
    if (url.endsWith('/videos/models')) return json({ data: videoRows });
    throw new Error(`unexpected ${url}`);
  });
}

beforeEach(() => { cache.clear(); vi.unstubAllGlobals(); });

describe('OpenRouter reference-to-video inputs (F1)', () => {
  it('adds a references slot only to descriptions that advertise a reference mode', async () => {
    catalogFetch();
    const listed = await openrouter.listModels('test');
    for (const id of seedanceIds) {
      const m = listed.find((row) => row.id === id)!;
      const schema = await openrouter.loadSchema(m, 'test');
      expect(schema.slots.images, id).toEqual(expect.objectContaining({ key: 'input_references', format: 'content-part', multiple: true }));
      expect(schema.slots.frameRules, id).toMatchObject({ refsWithFirst: false, refsWithLast: false });
    }
    const prime = await openrouter.loadSchema(listed.find((row) => row.id === 'alibaba/wan-3.0-prime')!, 'test');
    expect(prime.slots.images).toBeUndefined();
  });

  it('advertises reference images as image input to model selection', async () => {
    catalogFetch();
    const listed = await openrouter.listModels('test');
    expect(listed.find((row) => row.id === 'bytedance/seedance-2.0-mini')?.acceptsImage).toBe(true);
    expect(listed.find((row) => row.id === 'alibaba/wan-3.0-prime')?.acceptsImage).toBe(true);
  });

  it('sends each selected image in input_references and leaves frame_images out', async () => {
    catalogFetch();
    const listed = await openrouter.listModels('test');
    const id = 'bytedance/seedance-2.0-mini';
    const schema = await openrouter.loadSchema(listed.find((row) => row.id === id)!, 'test');
    expect(schema.slots.promptRefs).toBe('@Image1, @Video1, @Audio1… in input_references order');
    let sent: Record<string, unknown> | undefined;
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/videos')) { sent = JSON.parse(String(init?.body)); return json({ id: 'job-1', polling_url: '/api/v1/videos/job-1', status: 'pending' }); }
      if (url.endsWith('/api/v1/videos/job-1')) { seen.push(url); return json({ status: 'failed', error: 'stop test' }); }
      throw new Error(`unexpected ${url}`);
    });
    const req = videoRequest(id, schema);
    req.onRequest = () => undefined;
    await expect(openrouter.generate(req)).rejects.toThrow('stop test');
    expect(sent?.input_references).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,storyboard' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,character' } },
    ]);
    expect(sent).not.toHaveProperty('frame_images');
    expect(seen).toEqual(['https://openrouter.ai/api/v1/videos/job-1']);
  });

  it('routes Mini storyboard and character as references, and rejects explicit frames with references', async () => {
    catalogFetch();
    const listed = await openrouter.listModels('test');
    const miniSchema = await openrouter.loadSchema(listed.find((row) => row.id === 'bytedance/seedance-2.0-mini')!, 'test');
    expect(miniSchema.slots.firstFrame).toEqual({ key: 'frame_images', format: 'content-part' });
    expect(miniSchema.slots.lastFrame).toEqual({ key: 'frame_images', format: 'content-part' });
    const routed = routeVideoInputs(miniSchema.slots, ['storyboard', 'character'], []);
    expect(routed).toEqual({ images: ['storyboard', 'character'], videos: [] });
    expect(videoInputProblem(miniSchema.slots, { firstFrame: true, lastFrame: false, sourceVideo: false, images: 2, videos: 0 })).toMatch(/cannot combine reference media with a start frame/);
    expect(videoInputProblem(miniSchema.slots, { firstFrame: false, lastFrame: true, sourceVideo: false, images: 2, videos: 0 })).toMatch(/cannot combine reference media with a last frame/);
    expect(videoInputProblem(miniSchema.slots, { firstFrame: true, lastFrame: true, sourceVideo: false, images: 2, videos: 0 })).toMatch(/cannot combine reference media with a start frame/);
  });

  it('applies the OpenRouter Seedance reference protocol to the prompt writer', () => {
    const rule = REFERENCE_PROTOCOLS.find((entry) => entry.family === 'OpenRouter Seedance 2.0 Mini');
    expect(rule?.note).toContain('storyboard sets shot order and framing');
    expect(rule?.note).toContain('@Image1');
    expect(refMentionStyle('openrouter::bytedance/seedance-2.0-mini')).toEqual({ template: '@Image{n}', zeroBased: false });
  });

  it('normalizes relative polling metadata when resuming a persisted job', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url);
      return json({ status: 'failed', error: 'stop test' });
    });
    const job: RemoteJob = { provider: 'openrouter', id: 'resume-1', meta: { polling_url: '/api/v1/videos/resume-1' } };
    await expect(openrouter.resume!(job, { kind: 'video', apiKey: 'test', signal: new AbortController().signal, onStatus: () => undefined })).rejects.toThrow('stop test');
    expect(seen).toEqual(['https://openrouter.ai/api/v1/videos/resume-1']);
  });

  it('resolves relative polling URLs and preserves absolute polling URLs', async () => {
    catalogFetch();
    const listed = await openrouter.listModels('test');
    const id = 'bytedance/seedance-2.0-mini';
    const schema = await openrouter.loadSchema(listed.find((row) => row.id === id)!, 'test');
    const pollingUrls = ['/api/v1/videos/job-relative', 'https://jobs.example.test/poll/job-absolute'];
    for (const pollingUrl of pollingUrls) {
      let stored: unknown;
      vi.stubGlobal('fetch', async (url: string) => {
        if (url.endsWith('/videos')) { return json({ id: 'job', polling_url: pollingUrl, status: 'pending' }); }
        if (url === new URL(pollingUrl, 'https://openrouter.ai').href) return json({ status: 'failed', error: 'stop test' });
        throw new Error(`unexpected ${url}`);
      });
      await expect(openrouter.generate({ ...videoRequest(id, schema), onRemoteJob: (job) => { stored = job; } })).rejects.toThrow('stop test');
      expect(stored).toMatchObject({ meta: { polling_url: new URL(pollingUrl, 'https://openrouter.ai').href } });
    }
  });
});
