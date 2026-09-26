import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import atlasSnapshot from './fixtures/live/atlas.json';
import nanoSnapshot from './fixtures/live/nanogpt.json';
import { schemaFromJson, type JsonProp } from '../src/engine/params';
import { createGeneration, opSpec, runGeneration } from '../src/engine/jobs';
import { estimateSteps } from '../src/engine/executor';
import { sourceVideoRule } from '../src/engine/modelRules';
import { nanogpt } from '../src/engine/providers/nanogpt';
import { useStore } from '../src/store/store';
import type { Asset, ModelSchema, ModelSummary } from '../src/engine/types';

// The store debounces saves with window timers; node has none.
const fakeWindow = vi.hoisted(() => {
  const w = { setTimeout, clearTimeout, addEventListener: () => undefined };
  Object.assign(globalThis, { window: w, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
  return w;
});

// Browser storage is not available in node: blobs live in memory for the test.
const blobs = new Map<string, Blob>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, remove: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async (id: string) => blobs.get(id),
  putAssetBlob: async (id: string, b: Blob) => (blobs.set(id, b), id),
}));

// No image decoding in node: uploads take the bytes as they are.
vi.mock('../src/lib/media', async (orig) => ({ ...(await orig<typeof import('../src/lib/media')>()), prepareImageForUpload: async (b: Blob) => b }));

type Loose = any;
const SEEDANCE_ATLAS = 'bytedance/seedance-2.5/reference-to-video';

function atlasSchema(id: string): ModelSchema {
  const m = (atlasSnapshot as Loose).models.find((x: Loose) => x.model === id);
  const schemas = m.schemaDoc.components.schemas;
  const input = schemas.Input;
  return schemaFromJson({ ref: `atlas::${id}`, kind: 'video', properties: input.properties as Record<string, JsonProp>, required: input.required ?? [], resolve: (r) => schemas[r.split('/').pop()!], imageFormat: 'url', source: 'openapi' });
}

function install(ref: string, summary: Partial<ModelSummary>, schema: ModelSchema, seconds: number) {
  const [provider, id] = ref.split('::');
  const clip: Asset = { id: 'clip', kind: 'video', mime: 'video/mp4', width: 1280, height: 720, duration: seconds, sessionId: 's', origin: 'upload', stored: true, favorite: false, createdAt: 0 } as Asset;
  blobs.set('clip', new Blob([new Uint8Array(8)], { type: 'video/mp4' }));
  const st = useStore.getState();
  useStore.setState({
    assets: { clip },
    catalog: { ...st.catalog, models: { [ref]: { ref, provider, id, name: id, kind: 'video', acceptsText: true, acceptsImage: true, acceptsVideo: true, tags: [], ...summary } as ModelSummary }, schemas: { [ref]: schema } },
    settings: { ...st.settings, keys: { ...st.settings.keys, [provider]: 'k' }, ops: { ...st.settings.ops, videoEdit: ref, videoExtend: ref } },
  });
}

beforeEach(() => vi.stubGlobal('location', { href: 'http://localhost/' }));
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(globalThis, { window: fakeWindow });
});

describe('video edit / extend operations', () => {
  it('follows the Seedance 2.5 rules: edit with duration -1 and adaptive ratio, extend with a real length', async () => {
    install(`atlas::${SEEDANCE_ATLAS}`, { provider: 'atlas' }, atlasSchema(SEEDANCE_ATLAS), 8);
    const edit = await opSpec({ sessionId: 's', sourceAssetId: 'clip', op: 'video_edit', params: { instruction: 'make it night' }, origin: 'op' });
    expect(edit.settings).toMatchObject({ duration: -1, aspect: 'adaptive' });
    expect(edit.prompt).toMatch(/^make it night/);
    const extend = await opSpec({ sessionId: 's', sourceAssetId: 'clip', op: 'video_extend', params: { instruction: 'she walks away' }, origin: 'op' });
    expect(extend.settings).toMatchObject({ duration: 5, aspect: 'adaptive' });
    expect(extend.prompt).toMatch(/^Extend this video/);
  });

  it('sends the source clip as the one reference video when the model has no source field', async () => {
    install(`atlas::${SEEDANCE_ATLAS}`, { provider: 'atlas' }, atlasSchema(SEEDANCE_ATLAS), 8);
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('uploadMedia')) return new Response(JSON.stringify({ data: { download_url: 'https://cdn.test/clip.mp4' } }));
      if (url.includes('generateVideo')) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ message: 'stop here' }), { status: 400 });
      }
      throw new Error(`unexpected ${url}`);
    });
    const spec = await opSpec({ sessionId: 's', sourceAssetId: 'clip', op: 'video_extend', params: { instruction: 'she walks away' }, origin: 'op' });
    const g = createGeneration(spec);
    await expect(runGeneration(g.id)).rejects.toThrow('stop here');
    expect(body).toMatchObject({ model: SEEDANCE_ATLAS, reference_videos: ['https://cdn.test/clip.mp4'], ratio: 'adaptive', duration: 5 });
    expect(body).not.toHaveProperty('video');
  });

  it('refuses a clip outside the documented length before sending anything [VIDEO_DURATION]', async () => {
    install(`atlas::${SEEDANCE_ATLAS}`, { provider: 'atlas' }, atlasSchema(SEEDANCE_ATLAS), 3);
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    const spec = await opSpec({ sessionId: 's', sourceAssetId: 'clip', op: 'video_edit', params: { instruction: 'x' }, origin: 'op' });
    await expect(runGeneration(createGeneration(spec).id)).rejects.toThrow(/4–30 s.*\[VIDEO_DURATION\]/);
    expect(send).not.toHaveBeenCalled();
    expect(sourceVideoRule('bytedance/seedance-2.5')?.seconds.extend).toEqual([2, 30]);
  });

  it('names the operation for NanoGPT multi-mode models', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify({ data: url.includes('video-models') ? (nanoSnapshot as Loose).video : [] })));
    const models = await nanogpt.listModels(undefined);
    const seedance = models.find((m) => m.id === 'bytedance/seedance-2.5' && m.kind === 'video')!;
    install(seedance.ref, seedance, await nanogpt.loadSchema(seedance, undefined), 8);
    const extend = await opSpec({ sessionId: 's', sourceAssetId: 'clip', op: 'video_extend', params: { instruction: 'x' }, origin: 'op' });
    expect(extend.settings.advanced.mode).toBe('video-extend');
    const edit = await opSpec({ sessionId: 's', sourceAssetId: 'clip', op: 'video_edit', params: { instruction: 'x' }, origin: 'op' });
    expect(edit.settings.advanced.mode).toBe('video-edit');
  });

  it('a plan step that edits or extends a clip costs the same as the direct operation (R9)', async () => {
    const ref = `atlas::${SEEDANCE_ATLAS}`;
    install(ref, { provider: 'atlas', price: { skus: [{ usd: 0.1, unit: 'second' }] } }, atlasSchema(SEEDANCE_ATLAS), 12);
    for (const op of ['video_edit', 'video_extend'] as const) {
      const direct = await opSpec({ sessionId: 's', sourceAssetId: 'clip', op, params: { instruction: 'x' }, origin: 'op' });
      const { perStep } = estimateSteps([{ id: 's1', kind: 'op', title: 'e', op, input: 'asset:clip', params: { instruction: 'x' } }]);
      expect(perStep.s1.usd).toBeCloseTo(direct.estimate!.usd!);
    }
    // Edit is billed on the 12 s clip, extend on its 5 new seconds.
    expect(estimateSteps([{ id: 's1', kind: 'op', title: 'e', op: 'video_edit', input: 'asset:clip', params: {} }]).perStep.s1.usd).toBeCloseTo(1.2);
    expect(estimateSteps([{ id: 's1', kind: 'op', title: 'e', op: 'video_extend', input: 'asset:clip', params: {} }]).perStep.s1.usd).toBeCloseTo(0.5);
  });

  describe('subjects with any model (R10)', () => {
    const img = (id: string): Asset => ({ id, kind: 'image', mime: 'image/png', width: 64, height: 64, sessionId: 's', origin: 'upload', stored: true, favorite: false, createdAt: 0 }) as Asset;
    async function run(id: string, prompt: string, refs: string[]) {
      install(`atlas::${id}`, { provider: 'atlas' }, atlasSchema(id), 8);
      for (const a of ['r1', 'ana', 'ana2', 'leo']) blobs.set(a, new Blob([new Uint8Array(8)], { type: 'image/png' }));
      const st = useStore.getState();
      const base = st.sessions[st.activeSessionId];
      useStore.setState({
        assets: { ...st.assets, r1: img('r1'), ana: img('ana'), ana2: img('ana2'), leo: img('leo') },
        sessions: { ...st.sessions, s: { ...base, id: 's', subjects: [{ id: 'A', name: 'Ana', frontalAssetId: 'ana', refAssetIds: ['ana2'] }, { id: 'L', name: 'Leo', frontalAssetId: 'leo', refAssetIds: [] }] } },
      });
      let n = 0;
      let body: Record<string, unknown> = {};
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url.includes('uploadMedia')) return new Response(JSON.stringify({ data: { download_url: `https://cdn.test/${++n}.png` } }));
        if (url.includes('generateVideo')) {
          body = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ message: 'stop here' }), { status: 400 });
        }
        throw new Error(`unexpected ${url}`);
      });
      const g = createGeneration({ sessionId: 's', kind: 'video', prompt, modelRef: `atlas::${id}`, settings: { count: 1, advanced: {} }, inputs: { refs }, origin: 'agent' });
      await expect(runGeneration(g.id)).rejects.toThrow('stop here');
      return body;
    }

    it('Seedance: subject images follow the step refs and the mention is numbered from them', async () => {
      const body = await run(SEEDANCE_ATLAS, '@Ana waves at @Leo in the rain', ['r1']);
      expect(body.prompt).toBe('@Image2 waves at @Image3 in the rain');
      // r1, Ana frontal, Leo frontal, then Ana's extra view.
      expect(body.reference_images).toEqual(['https://cdn.test/1.png', 'https://cdn.test/2.png', 'https://cdn.test/3.png', 'https://cdn.test/4.png']);
    });

    it('MiniMax H3: <Picture N> in the mixed reference list', async () => {
      const body = await run('minimax/h3/reference-to-video', '<Picture 1> style. @Ana dances', ['r1']);
      expect(body.prompt).toBe('<Picture 1> style. <Picture 2> dances');
      expect((body.refers as unknown[]).length).toBe(3);
    });
  });
});
