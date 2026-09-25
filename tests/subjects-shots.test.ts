import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import atlasSnapshot from './fixtures/live/atlas.json';
import falSnapshot from './fixtures/live/fal.json';
import { mentionSubjects, schemaFromJson, shotsProblem, wireParams, type JsonProp } from '../src/engine/params';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { createGeneration, opSpec, runGeneration } from '../src/engine/jobs';
import { fal } from '../src/engine/providers/fal';
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
function falSchema(id: string, kind: MediaKind = 'video'): ModelSchema {
  const doc = (falSnapshot as Loose).models.find((m: Loose) => m.endpoint_id === id).schemaDoc;
  const schemas = doc.components.schemas;
  const input = schemas[doc.paths[`/${id}`].post.requestBody.content['application/json'].schema.$ref.split('/').pop()];
  return schemaFromJson({ ref: `fal::${id}`, kind, properties: input.properties as Record<string, JsonProp>, required: input.required ?? [], resolve: (r) => schemas[r.split('/').pop()!], imageFormat: 'data-url', source: 'openapi' });
}
function atlasSchema(id: string): ModelSchema {
  const schemas = (atlasSnapshot as Loose).models.find((m: Loose) => m.model === id).schemaDoc.components.schemas;
  return schemaFromJson({ ref: `atlas::${id}`, kind: 'video', properties: schemas.Input.properties, required: schemas.Input.required ?? [], resolve: (r) => schemas[r.split('/').pop()!], imageFormat: 'url', source: 'openapi' });
}
const KLING_REF_FAL = 'fal-ai/kling-video/o3/pro/reference-to-video';
const img = (id: string, kind: Asset['kind'] = 'image', duration?: number): Asset =>
  ({ id, kind, mime: kind === 'image' ? 'image/png' : kind === 'audio' ? 'audio/mpeg' : 'video/mp4', width: 512, height: 512, duration, sessionId: 's', origin: 'upload', stored: true, favorite: false, createdAt: 0 }) as Asset;

beforeEach(() => vi.stubGlobal('location', { href: 'http://localhost/' }));
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(globalThis, { window: fakeWindow });
});

describe('Kling subjects, shots and voices in live schemas', () => {
  it('reads Atlas and fal element lists with their mention syntax', () => {
    expect(atlasSchema('kwaivgi/kling-video-o3-pro/reference-to-video').slots.elements).toMatchObject({ style: 'atlas', mention: '<<<element_{n}>>>', refMax: 3, video: true, voice: false });
    expect(falSchema(KLING_REF_FAL).slots.elements).toMatchObject({ style: 'fal', mention: '@Element{n}', video: true, voice: true });
  });
  it('reads multi-shot storyboards and the switches that enable them', () => {
    const atlas = atlasSchema('kwaivgi/kling-v3.0-pro/text-to-video');
    expect(atlas.slots.shots).toMatchObject({ key: 'multi_prompt', indexed: true, durationAsString: true, flagKey: 'multi_shot', modeKey: 'shot_type', exclusivePrompt: false });
    expect(atlas.params.map((p) => p.key)).not.toContain('multi_shot');
    const falShots = falSchema('fal-ai/kling-video/v3/pro/image-to-video').slots.shots;
    expect(falShots).toMatchObject({ indexed: false, durationAsString: true, exclusivePrompt: true });
    const wired = wireParams(atlas, { count: 1, duration: 8, advanced: {}, shots: [{ prompt: 'wide', duration: 3 }, { prompt: 'close', duration: 5 }] }, 1);
    expect(wired).toMatchObject({ multi_prompt: [{ index: 1, prompt: 'wide', duration: '3' }, { index: 2, prompt: 'close', duration: '5' }], multi_shot: true, shot_type: 'customize' });
  });
  it('offers Grok voices as a multi-choice list and sends the picks', () => {
    const grok = atlasSchema('xai/grok-imagine-video-v1.5/reference-to-video');
    const voices = grok.params.find((p) => p.key === 'voice_ids')!;
    expect(voices).toMatchObject({ type: 'multi', max: 3 });
    expect(voices.options).toContain('eve');
    expect(wireParams(grok, { count: 1, advanced: {}, extras: { voice_ids: ['eve', 'leo'] } }, 1).voice_ids).toEqual(['eve', 'leo']);
  });
});

describe('subject mentions and shot checks', () => {
  const people = [{ id: 'a', name: 'Ana' }, { id: 'am', name: 'Ana Maria' }, { id: 'b', name: 'Bo' }];
  it('numbers subjects by first mention, longest names first, and keeps plain names elsewhere', () => {
    expect(mentionSubjects('@Bo waves at @Ana Maria while @Bo laughs', people, '@Element{n}')).toEqual({ prompt: '@Element1 waves at @Element2 while @Element1 laughs', ids: ['b', 'am'] });
    expect(mentionSubjects('@Ana runs', people, '<<<element_{n}>>>').prompt).toBe('<<<element_1>>> runs');
    expect(mentionSubjects('@Ana runs to @Bob', people).prompt).toBe('Ana runs to @Bob');
  });
  it('requires shots to add up to the clip', () => {
    expect(shotsProblem([{ prompt: 'a', duration: 3 }, { prompt: 'b', duration: 3 }], 8)).toMatch(/add up to 6 s but the clip is 8 s/);
    expect(shotsProblem([{ prompt: '', duration: 8 }], 8)).toMatch(/every shot needs a prompt/);
    expect(shotsProblem([{ prompt: 'a', duration: 8 }], 8)).toBeNull();
  });
  it('builds Atlas inline elements, reusing the frontal view when there are no others', async () => {
    const slots = atlasSchema('kwaivgi/kling-video-o3-pro/reference-to-video').slots;
    const face = { assetId: 'f', blob: new Blob(), mime: 'image/png', width: 1, height: 1 };
    const out = await structuredInputs(slots, { elements: [{ name: 'Mia', frontal: face, refs: [] }] }, async () => 'https://cdn.test/f.png', async () => 'https://cdn.test/v.mp4');
    expect(out.elements).toEqual([{ element_name: 'Mia', reference_type: 'image_refer', frontal_image: 'https://cdn.test/f.png', refer_images: ['https://cdn.test/f.png'] }]);
  });
});

describe('subjects and voices end to end (fal)', () => {
  function install(ref: string, schema: ModelSchema) {
    for (const id of ['mia', 'mia2', 'rex']) blobs.set(id, Object.assign(new Blob([new Uint8Array(4)], { type: 'image/png' }), { tag: id }));
    const st = useStore.getState();
    useStore.setState({
      assets: { mia: img('mia'), mia2: img('mia2'), rex: img('rex') },
      sessions: { ...st.sessions, s: { ...(Object.values(st.sessions)[0] as Loose), id: 's', subjects: [{ id: 'm', name: 'Mia', frontalAssetId: 'mia', refAssetIds: ['mia2'], voiceId: '829877809978941442' }, { id: 'r', name: 'Rex', refAssetIds: [] }] } },
      catalog: { ...st.catalog, models: { [ref]: { ref, provider: 'fal', id: ref.slice(5), name: 'Kling O3', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] } as ModelSummary }, schemas: { [ref]: schema } },
      settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' } },
    });
  }

  it('sends mentioned subjects as fal elements with their voice and rewrites the prompt', async () => {
    const ref = `fal::${KLING_REF_FAL}`;
    install(ref, falSchema(KLING_REF_FAL));
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://queue.fal.run/')) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ detail: 'stop here' }), { status: 400 });
      }
      throw new Error(`unexpected ${url}`);
    });
    const g = createGeneration({ sessionId: 's', kind: 'video', prompt: '@Mia greets the camera', modelRef: ref, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'composer' });
    await expect(runGeneration(g.id)).rejects.toThrow('stop here');
    expect(body.prompt).toBe('@Element1 greets the camera');
    expect(body.elements).toEqual([{ frontal_image_url: 'data:image/png;base64,mia', reference_image_urls: ['data:image/png;base64,mia2'], voice_id: '829877809978941442' }]);
  });

  it('refuses a subject without images before sending [SUBJECT_INCOMPLETE]', async () => {
    const ref = `fal::${KLING_REF_FAL}`;
    install(ref, falSchema(KLING_REF_FAL));
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    const g = createGeneration({ sessionId: 's', kind: 'video', prompt: '@Rex barks', modelRef: ref, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'composer' });
    await expect(runGeneration(g.id)).rejects.toThrow(/\[SUBJECT_INCOMPLETE\]/);
    expect(send).not.toHaveBeenCalled();
  });

  it('creates a Kling voice from 5–30 s of speech and refuses other lengths [VOICE_DURATION]', async () => {
    blobs.set('speech', new Blob([new Uint8Array(4)], { type: 'audio/mpeg' }));
    blobs.set('short', new Blob([new Uint8Array(4)], { type: 'audio/mpeg' }));
    const st = useStore.getState();
    useStore.setState({ assets: { speech: img('speech', 'audio', 12), short: img('short', 'audio', 2) }, settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' } } });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/fal-ai/kling-video/create-voice')) {
        expect(JSON.parse(String(init?.body)).voice_url).toMatch(/^data:audio\/mpeg/);
        return new Response(JSON.stringify({ request_id: 'q1' }));
      }
      if (url.endsWith('/status')) return new Response(JSON.stringify({ status: 'COMPLETED' }));
      if (url.endsWith('/requests/q1')) return new Response(JSON.stringify({ voice_id: 'v-123' }));
      throw new Error(`unexpected ${url}`);
    });
    const g = createGeneration(await opSpec({ sessionId: 's', sourceAssetId: 'speech', op: 'create_voice', params: {}, origin: 'op' }));
    await runGeneration(g.id);
    expect(useStore.getState().generations[g.id]).toMatchObject({ kind: 'text', status: 'done', text: 'v-123' });
    const short = createGeneration(await opSpec({ sessionId: 's', sourceAssetId: 'short', op: 'create_voice', params: {}, origin: 'op' }));
    await expect(runGeneration(short.id)).rejects.toThrow(/\[VOICE_DURATION\]/);
    expect(fal.createVoice).toBeTypeOf('function');
  });
});

describe('agent plans with shots', () => {
  const kling = atlasSchema('kwaivgi/kling-v3.0-pro/text-to-video');
  const ctx: PlanContext = {
    workspace: 'chat',
    getModel: async (r) => (r === 'atlas::kling' ? { model: { ref: r, provider: 'atlas', id: 'kling', name: 'Kling', kind: 'video', acceptsText: true, acceptsImage: false, tags: [] }, schema: kling } : null),
    defaultModel: () => 'atlas::kling',
    defaultSettings: () => ({}),
    asset: () => ({ kind: 'image' }),
    layer: () => undefined,
  };
  it('keeps a storyboard that fits and rejects one that does not', async () => {
    const ok = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'x', model: 'atlas::kling', duration: 8, shots: [{ prompt: 'wide', duration: 3 }, { prompt: 'close', duration: 5 }] }] }, ctx, 'p');
    expect(ok.errors).toEqual([]);
    expect((ok.plan!.steps[0] as Loose).settings.shots).toHaveLength(2);
    const bad = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'x', model: 'atlas::kling', duration: 8, shots: [{ prompt: 'wide', duration: 3 }] }] }, ctx, 'p');
    expect(bad.errors.join(' ')).toMatch(/add up to 3 s but the clip is 8 s/);
  });
});
