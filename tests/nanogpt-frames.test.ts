import { afterEach, describe, expect, it, vi } from 'vitest';
import { nanogpt } from '../src/engine/providers/nanogpt';
import { videoInputProblem } from '../src/engine/params';

vi.mock('../src/lib/idb', () => ({ cacheDb: { get: async () => undefined, set: async () => undefined } }));

afterEach(() => vi.unstubAllGlobals());

const videoModel = (id: string, parameters: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  architecture: { input_modalities: ['text', 'image'] },
  capabilities: { video_generation: true, text_to_video: true, image_to_video: true },
  supported_parameters: { parameters },
  ...extra,
});

async function schemaForVideo(...models: ReturnType<typeof videoModel>[]) {
  vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify({ data: url.includes('video-models') ? models : [] })));
  const listed = await nanogpt.listModels(undefined);
  return (id: string) => nanogpt.loadSchema(listed.find((m) => m.id === id)!, undefined);
}

describe('NanoGPT video input catalog', () => {
  it('enables a data URL last frame only when the catalog accepts one', async () => {
    const schema = await schemaForVideo(
      videoModel('minimax/h3-max', { imageUrl: { type: 'string' }, lastImageUrl: { type: 'string', description: 'Public HTTP(S) image URL or base64 image data URI' } }),
    );
    expect((await schema('minimax/h3-max')).slots.lastFrame).toEqual({ key: 'lastImageUrl', format: 'data-url' });
  });
  it('does not expose the undocumented referenceAudios request field', async () => {
    const schema = await schemaForVideo(videoModel('minimax/h3-max', { reference_audios: { type: 'text', description: 'Audio input references' } }));
    expect((await schema('minimax/h3-max')).slots.refAudios).toBeUndefined();
  });

  it('applies the catalog end-frame exclusions and start-frame requirement', async () => {
    const schema = await schemaForVideo(
      videoModel('minimax/h3-max', { lastImageUrl: { type: 'string', description: 'Optional end frame for image-to-video. Requires a start image. End frames cannot be combined with reference media or reference-to-video mode.' }, reference_images: { type: 'text' }, reference_videos: { type: 'text' } }),
      videoModel('google/gemini-omni-flash/v1.1', { lastImageUrl: { type: 'string', description: 'Optional end frame for image-to-video. Requires a start image. End frames cannot be combined with reference images, reference videos, or a source video.' } }, { capabilities: { text_to_video: true, image_to_video: true, video_to_video: true } }),
      videoModel('minimax/h3-max-turbo', { lastImageUrl: { type: 'string', description: 'Optional end frame for image-to-video. Requires a start image.' } }),
    );
    const h3 = await schema('minimax/h3-max');
    expect(h3.slots.frameRules).toMatchObject({ refsWithLast: false, lastNeedsFirst: true });
    expect(videoInputProblem(h3.slots, { firstFrame: false, lastFrame: true, sourceVideo: false, images: 1, videos: 0 })).toMatch(/cannot combine reference/);
    const gemini = await schema('google/gemini-omni-flash/v1.1');
    expect(gemini.slots.frameRules).toMatchObject({
      refsWithLast: false, sourceWithLast: false, lastNeedsFirst: true,
    });
    expect(videoInputProblem(gemini.slots, { firstFrame: false, lastFrame: true, sourceVideo: true, images: 0, videos: 0 })).toMatch(/cannot combine a source video/);
    expect((await schema('minimax/h3-max-turbo')).slots.frameRules).toMatchObject({ lastNeedsFirst: true });
  });

  it('allows Grok Imagine 1.5 1080p for text-to-video but rejects it with a start image', async () => {
    const schema = await schemaForVideo(videoModel('xai/grok-imagine-video/v1.5/image-to-video', {
      resolution: { type: 'select', label: 'Resolution', description: '1080p is available for text-to-video. Image and reference modes support 480p and 720p.', options: [{ value: '480p' }, { value: '720p' }, { value: '1080p' }] },
    }));
    const grok = await schema('xai/grok-imagine-video/v1.5/image-to-video');
    expect(grok.slots.frameRules).toMatchObject({ firstFrameResolutions: ['480p', '720p'] });
    expect(videoInputProblem(grok.slots, { firstFrame: true, lastFrame: false, sourceVideo: false, images: 0, videos: 0, resolution: '1080p' })).toBe('does not support 1080p with a start image.');
    expect(videoInputProblem(grok.slots, { firstFrame: false, lastFrame: false, sourceVideo: false, images: 0, videos: 0, resolution: '1080p' })).toBeNull();
  });
});
