import { afterEach, describe, expect, it, vi } from 'vitest';
import { nanogpt } from '../src/engine/providers/nanogpt';

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
});
