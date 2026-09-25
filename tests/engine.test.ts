import { describe, expect, it, vi } from 'vitest';
import { formatUsd } from '../src/lib/format';
import { extractErrorMessage, HttpError, JobFailedError, NetworkError, requestJson } from '../src/lib/http';
import { pollJob } from '../src/engine/providers/shared';
import type { ResumeContext } from '../src/engine/providers/types';
import { estimate, needsSpendCheck, sumEstimates, UNKNOWN, FREE } from '../src/engine/pricing';
import { coerceSettings, schemaFromJson, wireParams } from '../src/engine/params';
import { MAX_PLAN_STEPS, normalizePlan, topoOrder, type PlanContext } from '../src/engine/plan';
import { proposePlanSchema } from '../src/engine/agent/tools';
import { pickDefaultLlm, type LlmModel } from '../src/engine/providers/llm';
import { connect, connectionError, graphToSteps, planToGraph } from '../src/engine/flow/graph';
import { offlinePlan, type OfflineInput } from '../src/engine/agent/offline';
import { createDoc, insertLayer, moveLayer, newRasterLayer, newTextLayer, newVectorLayer, removeLayer, scaleLayer } from '../src/engine/design/doc';
import { layerAccepts, toolBlockReason } from '../src/engine/design/rules';
import type { ImageStep, Plan } from '../src/engine/types';

const schema = schemaFromJson({ ref: 'local:test', kind: 'image', properties: {
  prompt: { type: 'string' }, aspect_ratio: { type: 'string', enum: ['1:1', '16:9'] },
  num_images: { type: 'integer', minimum: 1, maximum: 4 }, seed: { type: 'integer' },
}, required: ['prompt'], resolve: () => undefined, imageFormat: 'url', source: 'derived' });
const image: ImageStep = { id: 'image', kind: 'image', title: 'Image', prompt: 'Forest', modelRef: 'local:test', settings: { count: 1, advanced: {} }, refs: [] };
const plan: Plan = { id: 'plan', title: 'Test', summary: '', workspace: 'node', adjustments: [], steps: [
  { id: 'prompt', kind: 'text', title: 'Prompt', text: 'A forest' }, { ...image, promptFrom: 'prompt' },
] };
const ctx: PlanContext = { workspace: 'designer', getModel: async () => null, defaultModel: () => null, defaultSettings: () => ({}), asset: () => ({ kind: 'video' }), layer: () => ({ type: 'text' }) };
const offline: OfflineInput = { request: 'Crea una imagen de un bosque', answers: {}, round: 0, maxRounds: 2, style: 'auto', workspace: 'chat', attachments: [] };

describe('cost checks', () => {
  it('requires consent for unknown and partially unknown prices', () => {
    expect(needsSpendCheck(FREE)).toBe(false);
    expect(needsSpendCheck(UNKNOWN)).toBe(true);
    const total = sumEstimates([FREE, UNKNOWN]);
    expect(total.lowerBound).toBe(true);
    expect(needsSpendCheck(total)).toBe(true);
  });
  it('multiplies per-second pricing by duration and output count', () => {
    expect(estimate({ skus: [{ unit: 'second', usd: 0.1 }] }, { count: 2, duration: 8 }).usd).toBe(1.6);
  });
  it('prices an automatic duration (-1) at the longest allowed, never negative', () => {
    const rule = { skus: [{ unit: 'second' as const, usd: 0.1 }] };
    const auto = estimate(rule, { count: 1, duration: -1, maxDuration: 12 });
    expect(auto.usd).toBeCloseTo(1.2);
    expect(auto.approximate).toBe(true);
    expect(auto.note).toMatch(/Automatic duration/);
    expect(estimate(rule, { count: 1, duration: -1 }).usd).toBeGreaterThan(0);
  });
  it('preserves the lower-bound flag for minimum-only pricing', () => {
    const minimum = estimate({ skus: [], minimumUsd: 0.05 }, { count: 3 });
    expect(minimum.usd).toBeCloseTo(0.15);
    expect(minimum.lowerBound).toBe(true);
  });
});

describe('provider parameters', () => {
  it('separates the prompt slot from settings and drops unknown fields', () => {
    expect(schema.slots.prompt).toBe('prompt');
    const { settings } = coerceSettings(schema, 'image', { aspect: '1:1', count: 99, seed: 42, advanced: { api_key: 'invalid' } });
    expect(settings.count).toBe(8);
    expect(settings.advanced).toEqual({});
    expect(wireParams(schema, settings, 2)).toMatchObject({ aspect_ratio: '1:1', num_images: 2, seed: 42 });
  });
  it('reports adjustments when the selected aspect is unsupported', () => {
    const result = coerceSettings(schema, 'image', { aspect: '4:5' });
    expect(result.settings.aspect).toBe('1:1');
    expect(result.changes).toHaveLength(1);
  });
  it('sends the count only to num_images when a model also has max_images (Seedream)', () => {
    const seedream = schemaFromJson({ ref: 'fal::seedream', kind: 'image', properties: {
      prompt: { type: 'string' }, max_images: { type: 'integer', minimum: 1, maximum: 6, default: 1 },
      num_images: { type: 'integer', minimum: 1, maximum: 6, default: 1 },
    }, required: ['prompt'], resolve: () => undefined, imageFormat: 'data-url', source: 'openapi' });
    expect(seedream.params.find((p) => p.key === 'max_images')?.role).toBe('other');
    expect(wireParams(seedream, coerceSettings(seedream, 'image', { count: 3 }).settings, 3)).toEqual({ num_images: 3 });
  });
  it('treats image_size as aspect only when its options are ratios', () => {
    const presets = schemaFromJson({ ref: 'atlas::krea', kind: 'image', properties: {
      prompt: { type: 'string' }, image_size: { type: 'string', enum: ['square_hd', 'portrait_3_4', 'portrait_9_16', 'landscape_16_9'] },
    }, required: [], resolve: () => undefined, imageFormat: 'url', source: 'openapi' });
    expect(coerceSettings(presets, 'image', { aspect: '9:16' }).settings.aspect).toBe('portrait_9_16');
    const tiers = schemaFromJson({ ref: 'x::tiers', kind: 'image', properties: {
      prompt: { type: 'string' }, image_size: { type: 'string', enum: ['1K', '2K'] }, orientation: { type: 'string', enum: ['default', 'align_image'] },
    }, required: [], resolve: () => undefined, imageFormat: 'url', source: 'openapi' });
    expect(tiers.params.map((p) => p.role)).toEqual(['other', 'other']);
  });
});

describe('video input', () => {
  it('finds the source video field in fal and Atlas schemas and never takes it as a frame', () => {
    const falUpscaler = schemaFromJson({ ref: 'fal::bytedance-upscaler', kind: 'video', properties: {
      video_url: { type: 'string' }, target_resolution: { type: 'string', enum: ['1080p', '2k', '4k'] },
    }, required: ['video_url'], resolve: () => undefined, imageFormat: 'data-url', source: 'openapi' });
    expect(falUpscaler.slots.video).toEqual({ key: 'video_url', format: 'data-url' });
    expect(falUpscaler.slots.firstFrame).toBeUndefined();
    expect(falUpscaler.params.some((p) => p.key === 'video_url')).toBe(false);
    const atlasEdit = schemaFromJson({ ref: 'atlas::wan-2.7/video-edit', kind: 'video', properties: {
      prompt: { type: 'string' }, video: { type: 'string' }, images: { type: 'array' }, resolution: { type: 'string', enum: ['720P', '1080P'] },
    }, required: ['video'], resolve: () => undefined, imageFormat: 'url', source: 'openapi' });
    expect(atlasEdit.slots.video?.key).toBe('video');
    expect(atlasEdit.slots.prompt).toBe('prompt');
    expect(atlasEdit.slots.images?.key).toBe('images');
  });
});

describe('agent model policy', () => {
  const llm = (id: string, tools = true, vision = true): LlmModel => ({ id, name: id, tools, vision });
  const catalog = [llm('anthropic/claude-opus-5.5'), llm('openai/gpt-5.6-sol'), llm('deepseek/deepseek-v4.1-flash'), llm('z-ai/glm-5.3-flash'), llm('x/other')];
  it('keeps the normal tier on its own list, in order', () => {
    expect(pickDefaultLlm(catalog)).toBe('z-ai/glm-5.3-flash');
    expect(pickDefaultLlm(catalog.filter((m) => !m.id.includes('glm')))).toBe('deepseek/deepseek-v4.1-flash');
  });
  it('uses the top tier only when asked, and skips models without tools or vision', () => {
    expect(pickDefaultLlm(catalog, 'top')).toBe('openai/gpt-5.6-sol');
    const noTools = [llm('openai/gpt-5.6-sol', false), llm('anthropic/claude-opus-5.5', true, false), llm('zai-org/glm-5.3-flash')];
    expect(pickDefaultLlm(noTools, 'top')).toBe('zai-org/glm-5.3-flash');
  });
  it('falls back to any capable model, then to any model with tools', () => {
    expect(pickDefaultLlm([llm('a', false), llm('b', true, false), llm('c')])).toBe('c');
    expect(pickDefaultLlm([llm('a', false), llm('b', true, false)])).toBe('b');
  });
});

describe('plan and graph validation', () => {
  it('applies one step limit to the tool schema and the normalizer', async () => {
    const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, kind: 'text', text: 'x' }));
    expect(proposePlanSchema.safeParse({ steps: steps(MAX_PLAN_STEPS) }).success).toBe(true);
    expect(proposePlanSchema.safeParse({ steps: steps(MAX_PLAN_STEPS + 1) }).success).toBe(false);
    expect((await normalizePlan({ title: 'T', steps: steps(MAX_PLAN_STEPS) }, ctx, 'p1')).errors.join()).not.toMatch(/Too many steps/);
    expect((await normalizePlan({ title: 'T', steps: steps(MAX_PLAN_STEPS + 1) }, ctx, 'p2')).errors.join()).toMatch(/Too many steps/);
    expect((await normalizePlan({ title: 'T', steps: steps(3) }, { ...ctx, maxSteps: 2 }, 'p3')).errors.join()).toMatch(/limit is 2/);
  });
  it('sorts dependencies and rejects cycles and missing references', () => {
    expect(topoOrder([...plan.steps].reverse())).toEqual(['prompt', 'image']);
    expect(() => topoOrder([{ ...image, refs: ['image'] }])).toThrow(/Cycle/);
    expect(() => topoOrder([{ ...image, refs: ['missing'] }])).toThrow(/Unknown step/);
  });
  it('rejects duplicate plan ids and incompatible layer content', async () => {
    const duplicate = await normalizePlan({ steps: [{ id: 'a', kind: 'text', text: 'A' }, { id: 'a', kind: 'text', text: 'B' }] }, ctx, 'p');
    expect(duplicate.plan).toBeNull();
    expect(duplicate.errors.join(' ')).toMatch(/Duplicate/);
    const video = await normalizePlan({ steps: [{ id: 'a', kind: 'layer', layer_type: 'raster', source: 'asset:video', target: 'base' }] }, ctx, 'p');
    expect(video.plan).toBeNull();
    expect(video.errors.length).toBeGreaterThan(0);
  });
  it('sends only the sketched copy downstream, never the original too', () => {
    const graph = planToGraph(plan);
    const imageId = graph.nodes.find((n) => n.data.kind === 'image')!.id;
    graph.nodes.push({ id: 'ref', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Ref', assetId: 'original', sketchAssetId: 'edited' } });
    graph.edges.push({ id: 'e-ref', source: 'ref', sourceHandle: 'out', target: imageId, targetHandle: 'ref' });
    const text = JSON.stringify(graphToSteps(graph, [imageId], {}).steps);
    expect(text).toContain('edited');
    expect(text).not.toContain('original');
  });
  it('roundtrips prompt wiring through graph execution', () => {
    const graph = planToGraph(plan);
    const promptId = graph.nodes.find((n) => n.data.kind === 'text')!.id;
    const imageId = graph.nodes.find((n) => n.data.kind === 'image')!.id;
    expect(graph.edges).toHaveLength(1);
    expect(connectionError(graph, {}, { source: promptId, target: imageId, targetHandle: 'ref' })).toMatch(/expects image/);
    expect(connectionError(graph, {}, { source: imageId, target: imageId, targetHandle: 'ref' })).toMatch(/itself/);
    const run = graphToSteps(graph, [imageId], {});
    expect(run.errors).toEqual([]);
    expect(run.steps.find((s) => s.id === imageId)).toMatchObject({ promptFrom: promptId });
    expect(connect(graph, { source: promptId, target: imageId, targetHandle: 'prompt' }).edges).toHaveLength(1);
  });
});

describe('offline planner', () => {
  it('plans automatically but asks questions in guided mode', () => {
    expect(offlinePlan(offline).kind).toBe('plan');
    expect(offlinePlan({ ...offline, style: 'guided' }).kind).toBe('questions');
    expect(offlinePlan({ ...offline, style: 'guided', round: 2 }).kind).toBe('plan');
  });
  it('puts generated Designer images on the base raster layer', () => {
    const result = offlinePlan({ ...offline, workspace: 'designer', request: 'Diseña un cartel de un bosque' });
    expect(result.kind).toBe('plan');
    if (result.kind === 'plan') expect(result.plan.steps).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'layer', layer_type: 'raster', target: 'base' })]));
  });
});

describe('Designer layers', () => {
  it('preserves bottom-to-top ordering and selection after deletion', () => {
    const a = newVectorLayer('Shapes');
    const b = newTextLayer('Title', 'Forest', { x: 0, y: 0, width: 100 });
    const doc = insertLayer(insertLayer(createDoc('Test', 100, 100), a), b);
    expect(doc.layers.map((l) => l.id)).toEqual([a.id, b.id]);
    expect(moveLayer(doc, b.id, -1).layers[0].id).toBe(b.id);
    expect(removeLayer(doc, b.id).activeLayerId).toBe(a.id);
    expect(doc.layers).toHaveLength(2);
  });
  it('keeps images non-destructive and blocks moving locked layers', () => {
    const layer = newTextLayer('Title', 'Text', { x: 0, y: 0, width: 100 });
    // The brush paints on its own layer, so it never blocks; the eraser needs a raster layer.
    expect(toolBlockReason('brush', layer)).toBeNull();
    expect(toolBlockReason('eraser', layer)).toMatch(/raster/);
    const image = newRasterLayer('Photo', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }, 'asset_1');
    expect(toolBlockReason('eraser', image)).toMatch(/protected/);
    expect(toolBlockReason('eraser', { ...image, allowPaint: true })).toBeNull();
    expect(toolBlockReason('eraser', newRasterLayer('Paint', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }))).toBeNull();
    // Auto-width text stays auto-width when scaled.
    const auto = scaleLayer(newTextLayer('T', 'Text', { x: 0, y: 0, width: 0 }), 2, 2, 0, 0);
    expect(auto.type === 'text' && auto.width).toBe(0);
    expect(toolBlockReason('move', { ...layer, locked: true })).toMatch(/locked/);
    expect(layerAccepts('raster', 'video')).toBe(false);
    expect(toolBlockReason('rect', layer)).toBeNull();
  });
});

describe('remote job polling', () => {
  const ctx = (): ResumeContext & { statuses: string[] } => {
    const statuses: string[] = [];
    return { kind: 'video', apiKey: 'k', signal: new AbortController().signal, onStatus: (t) => statuses.push(t), statuses };
  };
  it('retries failed status checks instead of failing the job', async () => {
    const c = ctx();
    let calls = 0;
    const result = await pollJob(c, 'Test', 1, async () => {
      calls++;
      if (calls === 1) throw new NetworkError('offline');
      if (calls === 2) throw new HttpError(503, 'busy', null);
      if (calls === 3) return 'Rendering';
      return { outputs: [{ url: 'https://x/v.mp4' }] };
    });
    expect(result.outputs).toHaveLength(1);
    expect(c.statuses.some((s) => s.startsWith('Connection problem'))).toBe(true);
  });
  it('stops at a confirmed failure or a non-temporary error without retrying', async () => {
    await expect(pollJob(ctx(), 'Test', 1, async () => { throw new JobFailedError('moderated'); })).rejects.toBeInstanceOf(JobFailedError);
    let calls = 0;
    const auth = pollJob(ctx(), 'Test', 1, async () => { calls++; throw new HttpError(401, 'bad key', null); });
    await expect(auth).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(1);
  });
  it('reads provider error objects as text', () => {
    expect(extractErrorMessage({ status: 'FAILED', error: { message: 'Content rejected' } }, 'x')).toBe('Content rejected');
    expect(extractErrorMessage({ userFriendlyError: 'Try another prompt', error: { code: 1 } }, 'x')).toBe('Try another prompt');
    expect(extractErrorMessage({ error: { code: 1 } }, 'Video failed')).toBe('Video failed');
  });
  it('turns a hung request into a network error, not a cancel', async () => {
    vi.stubGlobal('location', { href: 'http://localhost/' });
    vi.stubGlobal('fetch', (_: string, init: RequestInit) => new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    try {
      await expect(requestJson('https://api.example.com/status', { timeoutMs: 5 })).rejects.toBeInstanceOf(NetworkError);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('money formatting', () => {
  it('never shows a real cost as zero', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.00003)).toBe('<$0.001');
    expect(formatUsd(0.0051)).toBe('$0.0051');
    expect(formatUsd(0.055)).toBe('$0.055');
    expect(formatUsd(1.2)).toBe('$1.2');
  });
});
