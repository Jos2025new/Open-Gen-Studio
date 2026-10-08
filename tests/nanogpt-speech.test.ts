import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Text-to-speech and sound effects on NanoGPT (2026-10-08): only the models the user chose are offered, speech is
 * priced per 1000 characters spoken (never rounded to free), an effect at its longest length, and the request is
 * POST /v1/audio/speech with the words as `input`. Stubbed fetch: nothing reaches the provider.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { DEFAULT_SFX_REF, DEFAULT_SPEECH_REF, generateSpeech, speechSchema, speechSummaries } from '../src/engine/providers/nanogptAudio';
import { estimate, needsSpendCheck } from '../src/engine/pricing';
import { SYSTEM_PROMPT } from '../src/engine/agent/context';
import type { GenRequest } from '../src/engine/providers/types';
import type { ModelSummary } from '../src/engine/types';

// Trimmed from GET /v1/audio-models?detailed=true on 2026-10-08.
const CATALOG = [
  { id: 'google/gemini-3.8-flash-tts', name: 'Gemini 3.8 Flash TTS', category: 'audio_tts', pricing: { per_thousand_chars: 0.05 }, supported_parameters: { voices: ['Zephyr', 'Puck'], turn_input: { maxInputBytes: 8192 } } },
  { id: 'gpt-4o-mini-tts-2025-12-15', name: 'GPT-4o Mini TTS (2025-12-15)', category: 'audio_tts', pricing: { per_thousand_chars: 0.00102 }, supported_parameters: { max_chars: 4096, voices: ['alloy', 'nova'] } },
  { id: 'elevenlabs/eleven-v4', name: 'ElevenLabs v4', category: 'audio_tts', pricing: { per_thousand_chars: 0.136 }, supported_parameters: { max_chars: 10000, voices: ['Aria'] } },
  { id: 'elevenlabs/sound-effects/v2', name: 'ElevenLabs Sound Effects V2', category: 'audio_generation', pricing: { per_second: 0.002 }, supported_parameters: { max_duration: 22 } },
  { id: 'Kokoro-82m', name: 'Kokoro 82M', category: 'audio_tts', pricing: { per_thousand_chars: 0.0017 } },
  { id: 'Whisper-Large-V3', name: 'Whisper', category: 'audio_stt', pricing: { per_minute: 0.0005 }, capabilities: { speech_to_text: true } },
];

let sent: Array<{ url: string; body: Record<string, unknown> }> = [];
let reply: () => Response;
beforeEach(() => {
  sent = [];
  reply = () => new Response(new Blob(['ID3audio'], { type: 'audio/mpeg' }), { headers: { 'content-type': 'audio/mpeg' } });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('/audio-models')) return new Response(JSON.stringify({ data: CATALOG }), { headers: { 'content-type': 'application/json' } });
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return reply();
  });
});
afterEach(() => vi.unstubAllGlobals());

const summary = async (id: string) => (await speechSummaries()).find((m) => m.id === id) as ModelSummary;
const request = (model: ModelSummary, prompt: string, advanced: Record<string, string> = {}) =>
  ({ model, kind: 'audio', prompt, settings: { count: 1, advanced }, apiKey: 'k', onStatus: () => undefined, refs: [] }) as unknown as GenRequest;

describe('NanoGPT voice and effect models', () => {
  it('offers only the chosen models, as audio models that take text', async () => {
    const ids = (await speechSummaries()).map((m) => m.id);
    expect(ids).toEqual(['google/gemini-3.8-flash-tts', 'gpt-4o-mini-tts-2025-12-15', 'elevenlabs/eleven-v4', 'elevenlabs/sound-effects/v2']);
    expect(DEFAULT_SPEECH_REF).toBe('nanogpt::google/gemini-3.8-flash-tts');
    expect(DEFAULT_SFX_REF).toBe('nanogpt::elevenlabs/sound-effects/v2');
  });

  it('a speech schema has its voices; delivery instructions only where the model takes them', async () => {
    const gemini = await speechSchema(await summary('google/gemini-3.8-flash-tts'));
    expect(gemini.params.map((p) => p.key)).toEqual(['voice', 'instructions']);
    expect(gemini.params[0].options).toEqual(['Zephyr', 'Puck']);
    expect(gemini.slots.prompt).toBe('input');
    const eleven = await speechSchema(await summary('elevenlabs/eleven-v4'));
    expect(eleven.params.map((p) => p.key)).toEqual(['voice']);
    expect(eleven.slots.promptMax).toBe(10000);
  });
});

describe('the price of speech and effects', () => {
  it('speech is priced by the characters spoken', async () => {
    const price = (await summary('google/gemini-3.8-flash-tts')).price;
    expect(estimate(price, { count: 1, chars: 200 }).usd).toBe(0.01);
    expect(estimate(price, { count: 1, chars: 200 }).approximate).toBe(false);
  });

  it('a short paid line never rounds to free, so it still waits for approval', async () => {
    const e = estimate((await summary('gpt-4o-mini-tts-2025-12-15')).price, { count: 1, chars: 12 });
    expect(e.usd).toBeGreaterThan(0);
    expect(needsSpendCheck(e)).toBe(true);
  });

  it('an effect is priced at its longest length (an upper bound)', async () => {
    const e = estimate((await summary('elevenlabs/sound-effects/v2')).price, { count: 1 });
    expect(e.usd).toBe(0.044);
    expect(e.approximate).toBe(true);
  });
});

describe('the request', () => {
  it('sends the words as input with the voice and instructions, and keeps the audio that comes back', async () => {
    const out = await generateSpeech(request(await summary('google/gemini-3.8-flash-tts'), 'Hola, bienvenidos.', { voice: 'Puck', instructions: 'cálida y lenta' }));
    expect(sent[0].url).toBe('https://nano-gpt.com/api/v1/audio/speech');
    expect(sent[0].body).toEqual({ model: 'google/gemini-3.8-flash-tts', input: 'Hola, bienvenidos.', voice: 'Puck', instructions: 'cálida y lenta' });
    expect(out.outputs[0].mime).toBe('audio/mpeg');
    expect(out.outputs[0].blob?.size).toBeGreaterThan(0);
  });

  it('a model that takes no instructions does not get them', async () => {
    await generateSpeech(request(await summary('elevenlabs/eleven-v4'), 'Hi', { voice: 'Aria', instructions: 'whisper' }));
    expect(sent[0].body).toEqual({ model: 'elevenlabs/eleven-v4', input: 'Hi', voice: 'Aria' });
  });

  it('an answer with the audio URL is kept; an error is shown, never an empty result', async () => {
    reply = () => new Response(JSON.stringify({ audioUrl: 'https://cdn.example/a.wav', contentType: 'audio/wav', cost: 0.01 }), { headers: { 'content-type': 'application/json' } });
    const out = await generateSpeech(request(await summary('elevenlabs/sound-effects/v2'), 'thunder far away'));
    expect(out.outputs[0]).toEqual({ url: 'https://cdn.example/a.wav', mime: 'audio/wav' });
    reply = () => new Response(JSON.stringify({ error: { message: 'invalid_voice' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    await expect(generateSpeech(request(await summary('elevenlabs/eleven-v4'), 'Hi'))).rejects.toThrow(/invalid_voice|HTTP 400/);
  });
});

describe('the agent knows speech and effects', () => {
  it('names the default speech and effect models in the audio step contract', () => {
    expect(SYSTEM_PROMPT).toContain('nanogpt::google/gemini-3.8-flash-tts');
    expect(SYSTEM_PROMPT).toContain('nanogpt::elevenlabs/sound-effects/v2');
    expect(SYSTEM_PROMPT).toContain('the prompt is exactly the words spoken');
  });
});

describe('speech and effects in an agent plan', () => {
  it('a speech step keeps its words, voice and model; the plan prices the characters spoken', async () => {
    const { normalizePlan } = await import('../src/engine/plan');
    const { estimateSteps } = await import('../src/engine/executor');
    const { useStore } = await import('../src/store/store');
    const models: Record<string, ModelSummary> = {};
    const schemas: Record<string, Awaited<ReturnType<typeof speechSchema>>> = {};
    for (const m of await speechSummaries()) {
      models[m.ref] = m;
      schemas[m.ref] = await speechSchema(m);
    }
    const ctx = {
      workspace: 'node',
      getModel: async (r: string) => (models[r] ? { model: models[r], schema: schemas[r] } : null),
      defaultModel: () => null,
      defaultSettings: () => ({}),
      asset: () => undefined,
      layer: () => undefined,
    } as unknown as Parameters<typeof normalizePlan>[1];
    const words = 'Bienvenidos a la casa del lago.';
    const { plan, errors } = await normalizePlan(
      { title: 't', steps: [
        { id: 'v', kind: 'audio', model: DEFAULT_SPEECH_REF, prompt: words, params: { voice: 'Puck', instructions: 'cálida' } },
        { id: 'fx', kind: 'audio', model: DEFAULT_SFX_REF, prompt: 'olas suaves en la orilla' },
      ] } as Parameters<typeof normalizePlan>[0],
      ctx,
      'p',
    );
    expect(errors).toEqual([]);
    expect(plan!.steps[0]).toMatchObject({ kind: 'audio', modelRef: DEFAULT_SPEECH_REF, prompt: words });
    expect((plan!.steps[0] as { settings: { advanced: Record<string, unknown> } }).settings.advanced).toMatchObject({ voice: 'Puck', instructions: 'cálida' });
    const st = useStore.getState();
    useStore.setState({ catalog: { ...st.catalog, models: { ...st.catalog.models, ...models }, schemas: { ...st.catalog.schemas, ...schemas } } });
    const { perStep } = estimateSteps(plan!.steps);
    expect(perStep.v.usd).toBeCloseTo((0.05 * words.length) / 1000, 3); // the app rounds to 0.0001 USD
    expect(perStep.fx.usd).toBe(0.044);
  });
});
