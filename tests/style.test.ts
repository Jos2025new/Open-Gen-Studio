import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import falSnapshot from './fixtures/live/fal.json';
import { coerceSettings, normalizeStructured, schemaFromJson, structuredWire, wireParams, type JsonProp } from '../src/engine/params';
import { createGeneration, runGeneration } from '../src/engine/jobs';
import { RECRAFT_STYLE_REF } from '../src/engine/catalog';
import { useStore } from '../src/store/store';
import type { Asset, ModelSchema, ParamDef } from '../src/engine/types';

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
function falSchema(id: string): ModelSchema {
  const doc = (falSnapshot as Loose).models.find((m: Loose) => m.endpoint_id === id).schemaDoc;
  const schemas = doc.components.schemas;
  const input = schemas[doc.paths[`/${id}`].post.requestBody.content['application/json'].schema.$ref.split('/').pop()];
  return schemaFromJson({ ref: `fal::${id}`, kind: 'image', properties: input.properties as Record<string, JsonProp>, required: input.required ?? [], resolve: (r) => schemas[r.split('/').pop()!], imageFormat: 'data-url', source: 'openapi' });
}
const param = (s: ModelSchema, key: string) => s.params.find((p) => p.key === key) as ParamDef;

beforeEach(() => vi.stubGlobal('location', { href: 'http://localhost/' }));
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(globalThis, { window: fakeWindow });
});

describe('style controls in live schemas', () => {
  it('reads Recraft colors, background and style id', () => {
    const r = falSchema('recraft/v4/style/text-to-image');
    expect(param(r, 'colors')).toMatchObject({ type: 'colors', role: 'other' });
    expect(param(r, 'background_color')).toMatchObject({ type: 'color' });
    expect(param(r, 'style_id')).toMatchObject({ type: 'text' });
    const wired = wireParams(r, { count: 1, advanced: {}, extras: { colors: ['#ff0000', '#00ff00'], background_color: '#ffffff', style_id: 'abc-123' } }, 1);
    expect(wired).toMatchObject({ colors: [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }], background_color: { r: 255, g: 255, b: 255 }, style_id: 'abc-123' });
  });
  it('reads Ideogram palettes and style codes, and validates the codes', () => {
    const i = falSchema('fal-ai/ideogram/v3');
    const palette = param(i, 'color_palette');
    expect(palette.type).toBe('palette');
    expect(palette.options).toContain('PASTEL');
    expect(structuredWire(palette, 'pastel')).toEqual({ name: 'PASTEL' });
    expect(structuredWire(palette, [{ hex: '#102030', weight: 0.7 }, '#ffffff'])).toEqual({ members: [{ rgb: { r: 16, g: 32, b: 48 }, color_weight: 0.7 }, { rgb: { r: 255, g: 255, b: 255 } }] });
    const codes = param(i, 'style_codes');
    expect(normalizeStructured(codes, '1A2B3C4D, nothex, 5e6f7a8b')).toEqual(['1A2B3C4D', '5e6f7a8b']);
  });
  it('makes Ideogram custom models runnable with a model id and keeps agent hex colors', () => {
    const custom = falSchema('fal-ai/ideogram/custom-models/generate');
    expect(custom.missing).toBeUndefined();
    const { settings } = coerceSettings(falSchema('recraft/v4/style/text-to-image'), 'image', { count: 1, extras: { colors: '#abcdef, #123456', unknown_key: 'x' } });
    expect(settings.extras).toEqual({ colors: ['#abcdef', '#123456'] });
  });
});

describe('Recraft style creation', () => {
  it('turns the attached images into a style id through fal', async () => {
    const img = (id: string): Asset => ({ id, kind: 'image', mime: 'image/png', width: 512, height: 512, sessionId: 's', origin: 'upload', stored: true, favorite: false, createdAt: 0 }) as Asset;
    for (const id of ['a', 'b']) blobs.set(id, Object.assign(new Blob([new Uint8Array(4)], { type: 'image/png' }), { tag: id }));
    const st = useStore.getState();
    useStore.setState({ assets: { a: img('a'), b: img('b') }, settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' } } });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/fal-ai/recraft/v4/create-style')) {
        expect(JSON.parse(String(init?.body)).image_urls).toEqual(['data:image/png;base64,a', 'data:image/png;base64,b']);
        return new Response(JSON.stringify({ request_id: 'q9' }));
      }
      if (url.endsWith('/status')) return new Response(JSON.stringify({ status: 'COMPLETED' }));
      if (url.endsWith('/requests/q9')) return new Response(JSON.stringify({ style_id: '0f1e2d3c-aaaa-bbbb-cccc-111122223333' }));
      throw new Error(`unexpected ${url}`);
    });
    const g = createGeneration({ sessionId: 's', kind: 'text', prompt: 'Create Recraft style', modelRef: RECRAFT_STYLE_REF, settings: { count: 1, advanced: {} }, inputs: { refs: ['a', 'b'] }, origin: 'composer', estimate: { usd: null, approximate: true } });
    await runGeneration(g.id);
    expect(useStore.getState().generations[g.id]).toMatchObject({ status: 'done', text: '0f1e2d3c-aaaa-bbbb-cccc-111122223333' });
  });
});
