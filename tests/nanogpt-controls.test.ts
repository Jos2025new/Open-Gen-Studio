import { afterEach, describe, expect, it, vi } from 'vitest';
import { nanogpt } from '../src/engine/providers/nanogpt';
import type { GenRequest } from '../src/engine/providers/types';
import type { ModelSchema, ModelSummary } from '../src/engine/types';

vi.mock('../src/lib/idb', () => ({ cacheDb: { get: async () => undefined, set: async () => undefined } }));
afterEach(() => vi.unstubAllGlobals());

const imageModel = (id: string, supported_parameters: Record<string, unknown>) => ({
  id, name: id, architecture: { input_modalities: ['text'] }, capabilities: { image_generation: true }, supported_parameters,
});
const videoModel = (id: string, parameters: Record<string, unknown>) => ({
  id, name: id, architecture: { input_modalities: ['text', 'image'] }, capabilities: { text_to_video: true, image_to_video: true },
  supported_parameters: { parameters },
});
async function listed(images: unknown[] = [], videos: unknown[] = []) {
  vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify({ data: url.includes('images/models') ? images : url.includes('video-models') ? videos : [] })));
  return nanogpt.listModels(undefined);
}
const baseRequest = (model: ModelSummary, schema: ModelSchema, extra: Partial<GenRequest> = {}): GenRequest => ({
  kind: 'video', model, schema, prompt: 'Test', settings: { count: 1, advanced: { aspect_ratio: 'adaptive' } }, count: 1,
  refs: [], apiKey: 'unused-test-key', signal: new AbortController().signal, onStatus: () => undefined, onRemoteJob: () => undefined,
  ...extra,
});

describe('NanoGPT catalog controls', () => {
  it('exposes the documented Nano Banana 2.1 seed and web-search controls', async () => {
    const models = await listed([imageModel('nano-banana-2.1', {
      seed: { type: 'integer', default: -1 }, enable_web_search: { type: 'boolean', default: false },
    })]);
    const model = models.find((m) => m.id === 'nano-banana-2.1')!;
    const schema = await nanogpt.loadSchema(model, undefined);
    expect(schema.params).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'seed', type: 'integer', role: 'seed', default: -1 }),
      expect.objectContaining({ key: 'enable_web_search', type: 'boolean', default: false }),
    ]));
  });

});
