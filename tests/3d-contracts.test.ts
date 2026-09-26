import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nanoCatalog from './fixtures/3d/nanogpt.json';
import tripoText from './fixtures/3d/tripo-h3.1-text-to-3d.json';
import tripoImage from './fixtures/3d/tripo-h3.1-image-to-3d.json';
import seed3dAtlas from './fixtures/3d/bytedance-seed3d-v2.0-image-to-3d.json';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { estimateMedia } from '../src/engine/costs';
import { model3dProblem } from '../src/engine/modelRules';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { atlas, atlasModelOutputs } from '../src/engine/providers/atlas';
import { nanogpt } from '../src/engine/providers/nanogpt';
import { sniffModelMime, variant3dKey } from '../src/lib/model3d';
import { useStore } from '../src/store/store';
import type { GenSettings, ModelSchema, ModelSummary } from '../src/engine/types';

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
  blobToDataUrl: async (b: Blob) => `data:${b.type};base64,${btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())))}`,
  blobToCanvas: async () => {
    throw new Error('no canvas in node');
  },
}));

type Loose = any;
const ATLAS = 'https://api.atlascloud.ai';
const STATIC = 'https://static.atlascloud.ai/model/schema/';
const TRIPO_T = 'atlas::tripo-h3.1/text-to-3d';
const TRIPO_I = 'atlas::tripo-h3.1/image-to-3d';
const SEED_A = 'atlas::bytedance/seed3d-v2.0/image-to-3d';
const TRELLIS = 'nanogpt::wavespeed-ai/trellis-2/image-to-3d';
const MESHY_MULTI = 'nanogpt::meshy/v7.1/multi-image-to-3d';
const MESHY_T = 'nanogpt::meshy/v7.1/text-to-3d';

// Catalog rows as Atlas lists them (type Image, 3D categories), plus decoys that must stay hidden.
const atlasRows = [
  { model: 'tripo-h3.1/text-to-3d', type: 'Image', categories: ['TEXT-TO-3D'], schema: `${STATIC}tripo-h3.1-text-to-3d.json`, price: { actual: { base_price: '0.1' } }, displayName: 'Tripo H3.1 Text-to-3D' },
  { model: 'tripo-h3.1/image-to-3d', type: 'Image', categories: ['IMAGE-TO-3D'], schema: `${STATIC}tripo-h3.1-image-to-3d.json`, price: { actual: { base_price: '0.1' } }, displayName: 'Tripo H3.1 Image-to-3D' },
  { model: 'bytedance/seed3d-v2.0/image-to-3d', type: 'Image', categories: ['IMAGE-TO-3D'], schema: `${STATIC}bytedance-seed3d-v2.0-image-to-3d.json`, price: { actual: { base_price: '0.353' } }, displayName: 'Seed3D 2.0' },
  { model: 'meshy/v7/image-to-3d', type: 'Image', categories: ['IMAGE-TO-3D'], schema: `${STATIC}x.json`, price: { actual: { base_price: '0.5' } } },
  { model: 'tripo-v2.5/text-to-3d', type: 'Image', categories: ['TEXT-TO-3D'], schema: `${STATIC}y.json` },
];
const schemaDocs: Record<string, unknown> = {
  'tripo-h3.1-text-to-3d.json': tripoText,
  'tripo-h3.1-image-to-3d.json': tripoImage,
  'bytedance-seed3d-v2.0-image-to-3d.json': seed3dAtlas,
};

function glbBytes(): Uint8Array<ArrayBuffer> {
  const json = '{"asset":{"version":"2.0"}}  ';
  const b = new Uint8Array(20 + json.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, b.length, true);
  v.setUint32(12, json.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  b.set(new TextEncoder().encode(json), 20);
  return b;
}
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FBX = new Uint8Array(new TextEncoder().encode('Kaydara FBX Binary  \0'));
const octet = (b: Uint8Array<ArrayBuffer>) => new Response(b.slice(), { headers: { 'content-type': 'application/octet-stream' } });

async function loadCatalog(): Promise<{ models: Record<string, ModelSummary>; schemas: Record<string, ModelSchema>; listed: ModelSummary[] }> {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === `${ATLAS}/api/v1/models`) return new Response(JSON.stringify({ data: atlasRows }));
    const name = url.split('/').pop()!;
    if (schemaDocs[name]) return new Response(JSON.stringify(schemaDocs[name]));
    if (url.includes('/v1/3d-models')) return new Response(JSON.stringify({ data: nanoCatalog }));
    if (url.includes('/v1/images/models') || url.includes('/v1/video-models')) return new Response(JSON.stringify({ data: [] }));
    throw new Error(`unexpected ${url}`);
  });
  const listed = [...(await atlas.listModels(undefined)), ...(await nanogpt.listModels(undefined))].filter((m) => m.kind === 'model3d');
  const models: Record<string, ModelSummary> = {};
  const schemas: Record<string, ModelSchema> = {};
  for (const m of listed) {
    models[m.ref] = m;
    schemas[m.ref] = await (m.provider === 'atlas' ? atlas : nanogpt).loadSchema(m, undefined);
  }
  vi.unstubAllGlobals();
  vi.stubGlobal('location', { href: 'http://localhost/' });
  return { models, schemas, listed };
}

async function install() {
  const c = await loadCatalog();
  const st = useStore.getState();
  useStore.setState({
    assets: {
      img: { id: 'img', kind: 'image', mime: 'image/png', width: 800, height: 800, sessionId: 's', origin: 'upload', stored: true, favorite: false, createdAt: 0 },
      img2: { id: 'img2', kind: 'image', mime: 'image/png', width: 800, height: 800, sessionId: 's', origin: 'upload', stored: true, favorite: false, createdAt: 0 },
      wide: { id: 'wide', kind: 'image', mime: 'image/png', width: 3000, height: 1000, sessionId: 's', origin: 'upload', stored: true, favorite: false, createdAt: 0 },
    },
    generations: {},
    catalog: { ...st.catalog, models: c.models, schemas: c.schemas },
    settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k', nanogpt: 'k' } },
  });
  for (const id of ['img', 'img2', 'wide']) blobs.set(id, new Blob([PNG], { type: 'image/png' }));
  return c;
}

const s3d = (advanced: GenSettings['advanced'] = {}, resolution?: string): GenSettings => ({ count: 1, advanced, ...(resolution ? { resolution } : {}) });

beforeEach(() => vi.stubGlobal('location', { href: 'http://localhost/' }));
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(globalThis, { window: fakeWindow });
});

describe('3D catalogs: only the eight chosen endpoints', () => {
  it('lists Tripo H3.1, Seed3D 2.0, TRELLIS.2 and Meshy 7.1 as 3D models, nothing else', async () => {
    const { listed, models, schemas } = await loadCatalog();
    expect(listed.map((m) => m.ref).sort()).toEqual(
      [TRIPO_T, TRIPO_I, SEED_A, TRELLIS, 'nanogpt::bytedance/seed3d-2.0', 'nanogpt::meshy/v7.1/image-to-3d', MESHY_MULTI, MESHY_T].sort(),
    );
    expect(models[TRIPO_T]).toMatchObject({ acceptsText: true, acceptsImage: false });
    expect(models[TRIPO_I]).toMatchObject({ acceptsText: false, acceptsImage: true });
    // Atlas base price is the default configuration only: shown as a lower bound.
    expect(models[SEED_A].price).toMatchObject({ skus: [{ unit: 'output', usd: 0.353 }], lowerBound: true });
    expect(schemas[TRIPO_T].slots).toMatchObject({ prompt: 'prompt', promptRequired: true });
    expect(schemas[TRIPO_T].slots.images).toBeUndefined();
    expect(schemas[TRIPO_I].slots.images).toMatchObject({ key: 'image_url', max: 1, min: 1, multiple: false });
    expect(schemas[SEED_A].slots.images).toMatchObject({ key: 'image', max: 1, min: 1 });
    expect(schemas[SEED_A].params.map((p) => p.key)).not.toContain('enable_base64_output');
    expect(schemas[TRIPO_I].params.map((p) => p.key)).toEqual(expect.arrayContaining(['face_limit', 'quad', 'pbr', 'texture_quality']));
    expect(schemas[TRELLIS].slots.images).toMatchObject({ key: 'imageDataUrl', max: 1, min: 1 });
    expect(schemas[MESHY_MULTI].slots.images).toMatchObject({ key: 'imageDataUrls', max: 4, min: 1, multiple: true });
    expect(schemas[MESHY_T].slots).toMatchObject({ prompt: 'prompt', promptRequired: true });
    // texture_image is a URL field the app cannot fill from a local asset.
    expect(schemas[MESHY_T].params.map((p) => p.key)).not.toContain('texture_image');
  });

  it('prices NanoGPT runs by option set, never as free', async () => {
    await install();
    expect(variant3dKey('wavespeed-ai/trellis-2/image-to-3d', {})).toBe('1024');
    expect(variant3dKey('wavespeed-ai/trellis-2/image-to-3d', { resolution: '1536', texture_size: '4096' })).toBe('1536+4k-texture');
    expect(variant3dKey('meshy/v7.1/image-to-3d', { enable_rigging: true, enable_animation: true, geometry_resolution: '2k' })).toBe('textured:2k:rigged:animated');
    expect(variant3dKey('meshy/v7.1/text-to-3d', { mode: 'preview' })).toBe('untextured:standard:static');
    expect(estimateMedia(TRELLIS, 'model3d', s3d(), true)).toMatchObject({ usd: 0.2, approximate: false });
    expect(estimateMedia(TRELLIS, 'model3d', s3d({ texture_size: '4096' }, '512'), true)).toMatchObject({ usd: 0.15 });
    expect(estimateMedia(MESHY_MULTI, 'model3d', s3d({ enable_rigging: true }), true)).toMatchObject({ usd: 1.68 });
    expect(estimateMedia(TRIPO_I, 'model3d', s3d(), true)).toMatchObject({ usd: 0.1, lowerBound: true });
  });
});

describe('3D results', () => {
  it('types files by their bytes and separates the preview render', async () => {
    expect(await sniffModelMime(new Blob([glbBytes()]), 'image/png')).toBe('model/gltf-binary');
    expect(await sniffModelMime(new Blob([ZIP]))).toBe('application/zip');
    expect(await sniffModelMime(new Blob([FBX]))).toBe('application/vnd.autodesk.fbx');
    expect(await sniffModelMime(new Blob([PNG]), 'model/gltf-binary')).toBe('image/png');
    const outs = atlasModelOutputs({
      files: [{ url: 'https://cdn.test/m.glb', type: 'model', file_name: 'm.glb' }, { url: 'https://cdn.test/m.fbx', type: 'model', file_name: 'm.fbx' }],
      thumbnail: 'https://cdn.test/p.webp',
      outputs: ['https://cdn.test/m.glb', 'https://cdn.test/m.fbx', 'https://cdn.test/p.webp'],
    });
    expect(outs).toEqual([
      { url: 'https://cdn.test/m.glb', mime: 'model/gltf-binary' },
      { url: 'https://cdn.test/m.fbx', mime: 'application/vnd.autodesk.fbx' },
      { url: 'https://cdn.test/p.webp', mime: 'image/png' },
    ]);
    expect(atlasModelOutputs({ outputs: null })).toEqual([]);
  });

  it('Tripo image-to-3D (Atlas): uploads the image, polls prediction, keeps GLB and FBX, no image asset', async () => {
    await install();
    let body: Loose = {};
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.endsWith('/model/uploadMedia')) return new Response(JSON.stringify({ data: { download_url: 'https://up.test/in.png' } }));
      if (url.endsWith('/model/generateImage')) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ data: { id: 't1' } }));
      }
      if (url === `${ATLAS}/api/v1/model/prediction/t1`) {
        return new Response(
          JSON.stringify({
            data: {
              status: 'completed',
              files: [{ url: 'https://cdn.test/a.glb', file_name: 'a.glb' }, { url: 'https://cdn.test/a.fbx', file_name: 'a.fbx' }],
              thumbnail: 'https://cdn.test/a.png',
              outputs: ['https://cdn.test/a.glb', 'https://cdn.test/a.fbx', 'https://cdn.test/a.png'],
            },
          }),
        );
      }
      if (url === 'https://cdn.test/a.glb') return octet(glbBytes());
      if (url === 'https://cdn.test/a.fbx') return octet(FBX);
      if (url === 'https://cdn.test/a.png') return octet(PNG);
      throw new Error(`unexpected ${url}`);
    });
    const g = createGeneration({ sessionId: 's', kind: 'model3d', prompt: '', modelRef: TRIPO_I, settings: s3d({ quad: true }), inputs: { refs: ['img'] }, origin: 'composer' });
    const ids = await runGeneration(g.id);
    expect(body).toMatchObject({ model: 'tripo-h3.1/image-to-3d', image_url: 'https://up.test/in.png', quad: true });
    const assets = ids.map((id) => useStore.getState().assets[id]);
    expect(assets.map((a) => [a.kind, a.mime])).toEqual([
      ['model3d', 'model/gltf-binary'],
      ['model3d', 'application/vnd.autodesk.fbx'],
    ]);
    expect(assets.every((a) => a.stored)).toBe(true);
    expect(calls.filter((u) => u.endsWith('/generateImage'))).toHaveLength(1);
  });

  it('Seed3D (Atlas): asks for GLB, polls /model/result (the mock answers nowhere else), stores the ZIP as it came', async () => {
    await install();
    let body: Loose = {};
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/model/uploadMedia')) return new Response(JSON.stringify({ url: 'https://up.test/in.png' }));
      if (url.endsWith('/model/generateImage')) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ data: { id: 'z1' } }));
      }
      if (url === `${ATLAS}/api/v1/model/result/z1`) return new Response(JSON.stringify({ data: { status: 'completed', outputs: ['https://cdn.test/out.zip?sig=1'] } }));
      if (url === 'https://cdn.test/out.zip?sig=1') return octet(ZIP);
      throw new Error(`unexpected ${url}`);
    });
    const g = createGeneration({ sessionId: 's', kind: 'model3d', prompt: '', modelRef: SEED_A, settings: s3d(), inputs: { refs: ['img'] }, origin: 'composer' });
    const [id] = await runGeneration(g.id);
    expect(body).toMatchObject({ model: 'bytedance/seed3d-v2.0/image-to-3d', image: 'https://up.test/in.png', file_format: 'glb' });
    expect(body).not.toHaveProperty('enable_base64_output');
    expect(useStore.getState().assets[id]).toMatchObject({ kind: 'model3d', mime: 'application/zip', stored: true });
  });

  it('TRELLIS.2 and Meshy multi-view (NanoGPT): imageDataUrl through /generate-video, a GLB back', async () => {
    await install();
    const bodies: Loose[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/generate-video')) {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ runId: `r${bodies.length}`, cost: 0.2 }));
      }
      if (url.includes('/video/status?requestId=r')) return new Response(JSON.stringify({ data: { status: 'COMPLETED', output: { url: 'https://cdn.test/n.glb' }, cost: 0.2 } }));
      if (url === 'https://cdn.test/n.glb') return octet(glbBytes());
      throw new Error(`unexpected ${url}`);
    });
    const g = createGeneration({ sessionId: 's', kind: 'model3d', prompt: '', modelRef: TRELLIS, settings: s3d({ texture_size: '4096' }, '1536'), inputs: { refs: ['img'] }, origin: 'composer' });
    const [id] = await runGeneration(g.id);
    expect(bodies[0]).toMatchObject({ model: 'wavespeed-ai/trellis-2/image-to-3d', resolution: '1536', texture_size: '4096' });
    expect(String(bodies[0].imageDataUrl)).toMatch(/^data:image\/png;base64,/);
    expect(useStore.getState().assets[id]).toMatchObject({ kind: 'model3d', mime: 'model/gltf-binary' });
    expect(useStore.getState().generations[g.id]).toMatchObject({ status: 'done', estimate: { usd: 0.45 } });

    const m = createGeneration({ sessionId: 's', kind: 'model3d', prompt: '', modelRef: MESHY_MULTI, settings: s3d(), inputs: { refs: ['img', 'img2'] }, origin: 'composer' });
    await runGeneration(m.id);
    expect(bodies[1].imageDataUrls).toHaveLength(2);
    expect(bodies[1].imageDataUrl).toBe(bodies[1].imageDataUrls[0]);
  });

  it('a job that finishes with only a preview render fails instead of saving an image as a model', async () => {
    await install();
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/api/generate-video')) return new Response(JSON.stringify({ runId: 'p1' }));
      if (url.includes('requestId=p1')) return new Response(JSON.stringify({ data: { status: 'COMPLETED', output: { url: 'https://cdn.test/only.png' } } }));
      if (url === 'https://cdn.test/only.png') return octet(PNG);
      throw new Error(`unexpected ${url}`);
    });
    const g = createGeneration({ sessionId: 's', kind: 'model3d', prompt: '', modelRef: TRELLIS, settings: s3d(), inputs: { refs: ['img'] }, origin: 'composer' });
    await expect(runGeneration(g.id)).rejects.toThrow(/without a 3D file/);
    expect(Object.values(useStore.getState().assets).filter((a) => a.kind === 'model3d')).toEqual([]);
  });

  it('resumes a 3D job after a reload without submitting again', async () => {
    const send = vi.fn();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') send(url);
      if (url === `${ATLAS}/api/v1/model/result/z9`) return new Response(JSON.stringify({ data: { status: 'completed', outputs: ['https://cdn.test/r.zip'] } }));
      if (url === 'https://cdn.test/r.zip') return octet(ZIP);
      throw new Error(`unexpected ${url}`);
    });
    const res = await atlas.resume!({ provider: 'atlas', id: 'z9', meta: { pollUrl: `${ATLAS}/api/v1/model/result/z9` } }, { kind: 'model3d', apiKey: 'k', signal: new AbortController().signal, onStatus: () => undefined });
    expect(res.outputs).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('3D input rules (before any request)', () => {
  it('codes each problem', () => {
    const img = { acceptsText: false, acceptsImage: true };
    const txt = { acceptsText: true, acceptsImage: false };
    expect(model3dProblem('tripo-h3.1/image-to-3d', img, 'x', [])?.code).toBe('MODEL3D_IMAGE_REQUIRED');
    expect(model3dProblem('tripo-h3.1/text-to-3d', txt, '', [])?.code).toBe('PROMPT_MISSING');
    expect(model3dProblem('tripo-h3.1/text-to-3d', txt, 'x'.repeat(1025), [])?.code).toBe('PROMPT_TOO_LONG');
    expect(model3dProblem('tripo-h3.1/text-to-3d', txt, 'a vase', [{ size: 1, width: 1, height: 1 }])?.code).toBe('MODEL3D_NO_IMAGE_INPUT');
    expect(model3dProblem('bytedance/seed3d-v2.0/image-to-3d', img, '', [{ size: 1, width: 3000, height: 1000 }])?.code).toBe('IMAGE_ASPECT');
    expect(model3dProblem('bytedance/seed3d-v2.0/image-to-3d', img, '', [{ size: 11 * 1048576, width: 100, height: 100 }])?.code).toBe('IMAGE_TOO_LARGE');
    expect(model3dProblem('meshy/v7.1/multi-image-to-3d', img, '', Array(5).fill({ size: 1, width: 1, height: 1 }))?.code).toBe('MODEL3D_VIEWS');
    expect(model3dProblem('bytedance/seed3d-v2.0/image-to-3d', img, '', [{ size: 1, width: 800, height: 800 }])).toBeNull();
  });

  it('the runner refuses before sending', async () => {
    await install();
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    const g = createGeneration({ sessionId: 's', kind: 'model3d', prompt: '', modelRef: SEED_A, settings: s3d(), inputs: { refs: ['wide'] }, origin: 'composer' });
    await expect(runGeneration(g.id)).rejects.toThrow(/\[IMAGE_ASPECT\]/);
    const t = createGeneration({ sessionId: 's', kind: 'model3d', prompt: '', modelRef: TRIPO_I, settings: s3d(), origin: 'composer' });
    await expect(runGeneration(t.id)).rejects.toThrow(/\[MODEL3D_IMAGE_REQUIRED\]/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('3D in agent plans', () => {
  async function ctx(): Promise<PlanContext> {
    const { models, schemas } = await loadCatalog();
    return {
      workspace: 'node',
      getModel: async (r) => (models[r] ? { model: models[r], schema: schemas[r] } : null),
      defaultModel: (kind) => (kind === 'model3d' ? TRELLIS : kind === 'image' ? TRELLIS : null),
      defaultSettings: () => ({}),
      asset: () => undefined,
      layer: () => undefined,
    };
  }

  it('accepts image → 3D and refuses a 3D result used as an image', async () => {
    const c = await ctx();
    const ok = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'model3d', model: TRIPO_T, prompt: 'a ceramic teapot' }] }, c, 'p');
    expect(ok.errors).toEqual([]);
    expect(ok.plan!.steps[0]).toMatchObject({ kind: 'model3d', modelRef: TRIPO_T, settings: { count: 1 } });
    const noImage = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'model3d', prompt: 'a teapot' }] }, c, 'p');
    expect(noImage.errors.join(' ')).toMatch(/needs a reference image/);
    const misuse = await normalizePlan(
      { title: 't', steps: [{ id: 's1', kind: 'model3d', model: TRIPO_T, prompt: 'a teapot' }, { id: 's2', kind: 'model3d', model: TRIPO_I, prompt: '', refs: ['s1'] }] },
      c,
      'p',
    );
    expect(misuse.errors.join(' ')).toMatch(/produces model3d/);
  });
});
