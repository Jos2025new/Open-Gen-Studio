import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { atlas } from '../src/engine/providers/atlas';
import { nanogpt } from '../src/engine/providers/nanogpt';
import { routeVideo, type VideoPurpose } from '../src/engine/routing';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import type { ModelSchema, ModelSummary } from '../src/engine/types';
import { serve } from './fixtures/live/serve';

// The real catalogs and schemas of the regression net, read by the real adapters.
const adapters = { atlas, nanogpt } as const;
type P = keyof typeof adapters;
const lists = {} as Record<P, ModelSummary[]>;
const schemas = new Map<string, ModelSchema>();

beforeAll(async () => {
  vi.stubGlobal('location', { href: 'http://localhost/' });
  vi.stubGlobal('fetch', async (url: string) => {
    const body = serve(url);
    return body === undefined ? new Response('not in snapshot', { status: 404 }) : new Response(JSON.stringify(body));
  });
  for (const p of Object.keys(adapters) as P[]) lists[p] = await adapters[p].listModels(undefined);
});

function catalog(connected: P[]) {
  return async (ref: string) => {
    const p = ref.split('::')[0] as P;
    if (!connected.includes(p)) return null;
    const model = lists[p].find((m) => m.ref === ref);
    if (!model) return null;
    if (!schemas.has(ref)) schemas.set(ref, await adapters[p].loadSchema(model, undefined));
    return { model, schema: schemas.get(ref)! };
  };
}

const pick = async (purpose: VideoPurpose, step: { firstFrame?: boolean; refs?: number; duration?: number }, connected: P[] = ['atlas', 'nanogpt']) =>
  (await routeVideo(purpose, { firstFrame: Boolean(step.firstFrame), refs: step.refs ?? 0, duration: step.duration }, catalog(connected)))?.ref;

describe('video model by purpose (C1)', () => {
  it('normal: MiniMax H3 Developer on Atlas, in the variant the inputs need', async () => {
    expect(await pick('normal', {})).toBe('atlas::minimax/h3-developer/text-to-video');
    expect(await pick('normal', { firstFrame: true })).toBe('atlas::minimax/h3-developer/image-to-video');
    expect(await pick('normal', { refs: 2 })).toBe('atlas::minimax/h3-developer/reference-to-video');
  });

  it('draft: MiniMax H3 Max Turbo; with references (it has none) the normal row takes over', async () => {
    expect(await pick('draft', {})).toBe('atlas::minimax/h3-max-turbo/text-to-video');
    expect(await pick('draft', { firstFrame: true })).toBe('atlas::minimax/h3-max-turbo/image-to-video');
    expect(await pick('draft', { refs: 1 })).toBe('atlas::minimax/h3-developer/reference-to-video');
  });

  it('draft on NanoGPT alone: FLUX 3 with quality "draft", priced at the draft rate; a 20 s draft too', async () => {
    expect(await pick('draft', {}, ['nanogpt'])).toBe('nanogpt::flux-3');
    expect(await pick('draft', { firstFrame: true, duration: 20 }, ['nanogpt'])).toBe('nanogpt::flux-3');
    expect(await pick('draft', { duration: 20 })).toBe('nanogpt::flux-3'); // H3 Max Turbo stops at 15 s
    const { estimate } = await import('../src/engine/pricing');
    const price = lists.nanogpt.find((m) => m.ref === 'nanogpt::flux-3')!.price;
    expect(estimate(price, { count: 1, duration: 10, resolution: '720p', quality: 'draft' }).usd).toBeCloseTo(0.6);
    expect(estimate(price, { count: 1, duration: 10, resolution: '720p' }).usd).toBeCloseTo(1.7);
  });

  it('a length a cheaper model cannot make moves down the row; long is Wan 3', async () => {
    const twenty = await pick('normal', { duration: 20 });
    expect(twenty).toMatch(/wan-3\.0/);
    expect(await pick('long', { duration: 30 })).toBe('atlas::alibaba/wan-3.0/text-to-video');
  });

  it('only NanoGPT connected: Seedance 2.0 Fast, the cheapest NanoGPT entry of the row', async () => {
    expect(await pick('normal', {}, ['nanogpt'])).toBe('nanogpt::bytedance-seedance-2-0-fast');
    expect(await pick('long', {}, ['nanogpt'])).toBe('nanogpt::alibaba/wan-3.0/text-to-video');
  });

  it('nothing connected: no pick, the caller keeps its default', async () => {
    expect(await pick('normal', {}, [])).toBeUndefined();
  });
});

describe('the plan follows the table unless the user picked the composer model (C1, C2)', () => {
  const ctx = (chosen: boolean, routes: Partial<Record<'text' | 'image' | 'reference', string>> = {}): PlanContext => ({
    workspace: 'chat',
    getModel: catalog(['atlas', 'nanogpt']),
    defaultModel: () => 'atlas::kwaivgi/kling-v3.0-pro/text-to-video',
    defaultSettings: () => ({}),
    asset: () => ({ kind: 'image', width: 1280, height: 720 }),
    layer: () => undefined,
    composerChosen: () => chosen,
    routeModel: (mode) => routes[mode],
  });
  const model = async (chosen: boolean, step: Record<string, unknown>, routes: Partial<Record<'text' | 'image' | 'reference', string>> = {}) =>
    ((await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'a cat walks', ...step }] }, ctx(chosen, routes), 'p')).plan?.steps[0] as { modelRef?: string } | undefined)?.modelRef;

  it('not picked by hand: the purpose row, noted on the card; a named model still wins', async () => {
    expect(await model(false, { purpose: 'draft' })).toBe('atlas::minimax/h3-max-turbo/text-to-video');
    expect(await model(false, {})).toBe('atlas::minimax/h3-developer/text-to-video');
    const r = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'x', purpose: 'normal' }] }, ctx(false), 'p');
    expect(r.plan!.adjustments.join(' ')).toMatch(/normal video → MiniMax H3 Developer \(atlas\)/);
    expect(await model(false, { model: 'atlas::alibaba/wan-3.0/text-to-video' })).toBe('atlas::alibaba/wan-3.0/text-to-video');
  });

  it('a 20 s draft goes to FLUX 3 on NanoGPT with quality "draft" set on the step', async () => {
    const r = await normalizePlan({ title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'a cat walks', purpose: 'draft', duration: 20 }] }, ctx(false), 'p');
    const st = r.plan!.steps[0] as { modelRef: string; settings: { advanced: Record<string, unknown> } };
    expect(st.modelRef).toBe('nanogpt::flux-3');
    expect(st.settings.advanced.quality).toBe('draft');
  });

  it('picked by hand: the composer model, as before', async () => {
    expect(await model(true, { purpose: 'draft' })).toBe('atlas::kwaivgi/kling-v3.0-pro/text-to-video');
  });

  it('a model named in the plan still wins over a picked composer model', async () => {
    expect(await model(true, { purpose: 'draft', model: 'atlas::alibaba/wan-3.0/text-to-video' })).toBe('atlas::alibaba/wan-3.0/text-to-video');
  });

  it('an exact route override wins over the global pick and only for its input route', async () => {
    const text = 'atlas::alibaba/wan-3.0/text-to-video';
    const image = 'atlas::minimax/h3-developer/image-to-video';
    const reference = 'atlas::minimax/h3-developer/reference-to-video';
    expect(await model(true, {}, { text })).toBe(text);
    expect(await model(true, { first_frame: 'asset:a' }, { image })).toBe(image);
    expect(await model(true, { refs: ['asset:a'] }, { reference })).toBe(reference);
    // A text-only override must not leak into an image route; with no global pick, normal auto routing remains next.
    expect(await model(false, { first_frame: 'asset:a' }, { text })).toBe('atlas::minimax/h3-developer/image-to-video');
  });

  it('rejects a route override that no longer fits instead of silently spending with it', async () => {
    const wrong = 'atlas::alibaba/wan-3.0/text-to-video';
    const result = await normalizePlan(
      { title: 't', steps: [{ id: 's1', kind: 'video', prompt: 'a cat walks', first_frame: 'asset:a' }] },
      ctx(false, { image: wrong }),
      'p',
    );
    expect(result.errors.join(' ')).toMatch(/selected for image-to-video no longer fits/);
  });
});
