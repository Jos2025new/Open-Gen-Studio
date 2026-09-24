import { describe, expect, it } from 'vitest';
import { estimate, needsSpendCheck, sumEstimates, UNKNOWN, FREE } from '../src/engine/pricing';
import { coerceSettings, schemaFromJson, wireParams } from '../src/engine/params';
import { normalizePlan, topoOrder, type PlanContext } from '../src/engine/plan';
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
});

describe('plan and graph validation', () => {
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
