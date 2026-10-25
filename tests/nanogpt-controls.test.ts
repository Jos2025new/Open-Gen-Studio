import { afterEach, describe, expect, it, vi } from 'vitest';
import nanoCatalog from './fixtures/live/nanogpt.json';
import { nanogpt } from '../src/engine/providers/nanogpt';
import { fitBody, NANOGPT_BODY_LIMIT } from '../src/engine/providers/bodyBudget';
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
  kind: 'video', model, schema, prompt: 'Test', settings: { count: 1, aspect: 'adaptive', advanced: {} }, count: 1,
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

  it('keeps the catalog adaptive aspect ratio in the H3 Max request body', async () => {
    const models = await listed([], [videoModel('minimax/h3-max', { aspect_ratio: { type: 'select', options: [{ value: 'adaptive' }, { value: '16:9' }] } })]);
    const model = models.find((m) => m.id === 'minimax/h3-max')!;
    const schema = await nanogpt.loadSchema(model, undefined);
    let sent: Record<string, unknown> | undefined;
    vi.stubGlobal('location', { href: 'http://localhost/' });
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') sent = JSON.parse(String(init.body));
      throw new Error('stop after capturing submit body');
    });
    await expect(nanogpt.generate(baseRequest(model, schema))).rejects.toThrow(/Network error reaching nano-gpt.com/);
    expect(sent?.aspect_ratio).toBe('adaptive');
  });

  it('preserves the real catalog label and scope for MiniMax H3 LoRA/edit/extend resolution', async () => {
    const modelEntry = nanoCatalog.video.find((m) => m.id === 'minimax-h3')!;
    const models = await listed([], [modelEntry]);
    const schema = await nanogpt.loadSchema(models.find((m) => m.id === 'minimax-h3')!, undefined);
    expect(schema.params.find((p) => p.key === 'resolution')).toMatchObject({
      label: 'LoRA / Edit / Extend Resolution',
      description: 'LoRA generation supports all listed resolutions; edit/extend support 480p and 768p. Generation without LoRAs remains 2K.',
    });
  });

  it('rejects talking-avatar audio over 4 MB before making a provider request', async () => {
    const models = await listed([], [videoModel('bytedance/seedance-2.5/talking-avatar', { audio: { type: 'string', description: 'Required voice recording, up to 120 seconds' } })]);
    const model = models.find((m) => m.id === 'bytedance/seedance-2.5/talking-avatar')!;
    const schema = await nanogpt.loadSchema(model, undefined);
    let requests = 0;
    vi.stubGlobal('fetch', async () => { requests++; throw new Error('unexpected request'); });
    const audio = { assetId: 'a', blob: new Blob([new Uint8Array(4_000_001)], { type: 'audio/mpeg' }), mime: 'audio/mpeg', width: 0, height: 0 };
    await expect(nanogpt.generate(baseRequest(model, schema, { audio }))).rejects.toThrow(/audio.*app.*4 MB/i);
    expect(requests).toBe(0);
  });

  it('explains when an audio-only data URL exceeds the body limit', async () => {
    await expect(fitBody({ audio: `data:audio/mpeg;base64,${'a'.repeat(NANOGPT_BODY_LIMIT)}` }, NANOGPT_BODY_LIMIT)).rejects.toThrow(/audio.*app.*4 MB.*Nothing was sent or charged/i);
  });

});
