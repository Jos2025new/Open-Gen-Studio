import { describe, expect, it, vi } from 'vitest';
import expectedTxt from './fixtures/live/expected.txt?raw';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { inIndex, searchIndex, tokens } from '../src/engine/agent/modelIndex';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import type { MediaKind, ModelSummary } from '../src/engine/types';

// The app's parsed catalog (regression net): "provider::id [kind] inputs", with MISSING lines under a model.
function snapshotModels(): { models: ModelSummary[]; missing: Set<string> } {
  const models: ModelSummary[] = [];
  const missing = new Set<string>();
  let last = '';
  for (const line of expectedTxt.split('\n')) {
    const m = /^(\w+)::(\S+) \[(\w+)\] (.*)$/.exec(line);
    if (m) {
      const [, provider, id, kind, inputs] = m;
      last = `${provider}::${id}`;
      models.push({
        ref: last,
        provider: provider as ModelSummary['provider'],
        id,
        name: id,
        kind: kind as MediaKind,
        acceptsText: /\btext\b/.test(inputs),
        acceptsImage: /\bimage\b/.test(inputs),
        acceptsVideo: /video-in/.test(inputs),
        needsVideo: /NEEDS-VIDEO/.test(inputs),
        tags: [],
      });
    } else if (/^\s+MISSING:/.test(line)) missing.add(last);
  }
  return { models: models.filter((x) => inIndex(x, missing.has(x.ref) ? { ref: x.ref, params: [], slots: {}, missing: ['x'], source: 'catalog' } : undefined)), missing };
}

describe('find_models index', () => {
  const { models, missing } = snapshotModels();

  it('splits names the way people write them', () => {
    expect(tokens('Seedance 2.0 Fast')).toEqual(['seedance', '2', '0', 'fast']);
    expect(tokens('bytedance-seedance-2-0-fast')).toEqual(['bytedance', 'seedance', '2', '0', 'fast']);
    expect(tokens('kling-v30-pro')).toEqual(['kling', 'v', '30', 'pro']);
  });

  it('finds Seedance 2.0 Fast (the case the agent missed), image-to-video first when there is an image', () => {
    const found = searchIndex(models, 'seedance 2.0 fast', { kind: 'video', needsImage: true });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((m) => /seedance/.test(m.id) && /fast/.test(m.id) && /2[-.]0/.test(m.id))).toBe(true);
    expect(found[0].acceptsImage).toBe(true);
    expect(found.map((m) => m.ref)).toContain('nanogpt::bytedance-seedance-2-0-fast');
  });

  it('only indexes the refined catalog: no models outside the families, none the app cannot run', () => {
    expect(models.every((m) => m.provider !== 'local')).toBe(true);
    expect(models.some((m) => missing.has(m.ref))).toBe(false);
    expect(searchIndex(models, 'hunyuan video')).toEqual([]);
    expect(searchIndex(models, 'totally unknown model')).toEqual([]);
  });

  it('the validator suggests the closest ref instead of a dead end', async () => {
    const byRef = new Map(models.map((m) => [m.ref, m]));
    const ctx: PlanContext = {
      workspace: 'chat',
      getModel: async (r) => (byRef.has(r) ? { model: byRef.get(r)!, schema: { ref: r, params: [], slots: { prompt: 'prompt', firstFrame: { key: 'image', format: 'url' } }, source: 'catalog' } } : null),
      defaultModel: () => null,
      defaultSettings: () => ({}),
      asset: () => ({ kind: 'image' }),
      layer: () => undefined,
      suggestModel: (ref, kind, needsImage) => searchIndex(models, ref, { kind, needsImage, limit: 1 })[0]?.ref,
    };
    const { errors } = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'walk', model: 'nanogpt::seedance-2.0-fast', first_frame: 'asset:a' }] }, ctx, 'p');
    expect(errors.join(' ')).toMatch(/Did you mean "[^"]*seedance[^"]*2[-.]0[^"]*fast[^"]*"\?/);
  });

  it('leaves out "-spicy" variants unless they are asked for by name', () => {
    expect(searchIndex(models, 'seedance 2.5', { kind: 'video', limit: 50 }).some((m) => /spicy/.test(m.id))).toBe(false);
    expect(searchIndex(models, 'seedance 2.5 spicy', { kind: 'video' })[0].id).toMatch(/spicy/);
  });
});

describe('default route: family names resolve locally (R1)', () => {
  const { models } = snapshotModels();
  const byRef = new Map(models.map((m) => [m.ref, m]));
  const ctx = (provider: string): PlanContext => ({
    workspace: 'chat',
    getModel: async (r) => (byRef.has(r) ? { model: byRef.get(r)!, schema: { ref: r, params: [], slots: { prompt: 'prompt', firstFrame: { key: 'image', format: 'url' } }, source: 'catalog' } } : null),
    defaultModel: () => null,
    defaultSettings: () => ({}),
    asset: () => ({ kind: 'image' }),
    layer: () => undefined,
    suggestModel: (ref, kind, needsImage) => searchIndex(models, ref, { kind, needsImage, limit: 1, provider })[0]?.ref,
  });

  it('"Wan 3" with a start image becomes the image-to-video variant of the selected provider, noted as an adjustment', async () => {
    const { plan, errors } = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'walk', model: 'Wan 3', first_frame: 'asset:a' }] }, ctx('nanogpt'), 'p');
    expect(errors).toEqual([]);
    const step = plan!.steps[0] as { modelRef: string };
    expect(step.modelRef).toBe('nanogpt::alibaba/wan-3.0/image-to-video');
    expect(plan!.adjustments?.join(' ') ?? '').toMatch(/"Wan 3" → nanogpt::alibaba\/wan-3\.0\/image-to-video/);
  });

  it('without an image it is the text-to-video variant; a full ref passes as given', async () => {
    const a = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'a city', model: 'wan 3' }] }, ctx('atlas'), 'p');
    expect((a.plan!.steps[0] as { modelRef: string }).modelRef).toBe('atlas::alibaba/wan-3.0/text-to-video');
    const b = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'a city', model: 'fal::minimax/h3/text-to-video' }] }, ctx('atlas'), 'p');
    expect((b.plan!.steps[0] as { modelRef: string }).modelRef).toBe('fal::minimax/h3/text-to-video');
  });
});

describe('find_models finds the FLUX 3 image models', () => {
  const fake = (provider: string, id: string, name: string, kind: MediaKind): ModelSummary => ({ ref: `${provider}::${id}`, provider: provider as ModelSummary['provider'], id, name, kind, acceptsText: true, acceptsImage: false, tags: [] });
  const catalog = [
    fake('openrouter', 'black-forest-labs/flux.3-klein', 'FLUX 3 Image Klein', 'image'),
    fake('openrouter', 'black-forest-labs/flux.3-klein-edit', 'FLUX 3 Image Klein Edit', 'image'),
    fake('atlas', 'blackforestlabs/flux-3/text-to-image', 'BLACKFORESTLABS FLUX 3 Text-to-Image', 'image'),
    fake('atlas', 'black-forest-labs/flux-3/text-to-video', 'FLUX 3 Text-to-Video', 'video'),
  ];
  const indexed = catalog.filter((m) => inIndex(m, undefined));

  it('the image FLUX 3 models are in the index (the image family had no FLUX 3, only the video one)', () => {
    expect(indexed.map((m) => m.name)).toEqual(expect.arrayContaining(['FLUX 3 Image Klein', 'FLUX 3 Image Klein Edit', 'BLACKFORESTLABS FLUX 3 Text-to-Image']));
  });
  it.each(['flux 3 klein', 'flux klein', 'FLUX 3 Image Klein'])('"%s" for an image step finds Klein, not only the video models', (q) => {
    const found = searchIndex(indexed, q, { kind: 'image' });
    expect(found.map((m) => m.name)).toContain('FLUX 3 Image Klein');
    expect(found.every((m) => m.kind === 'image')).toBe(true);
  });
});
