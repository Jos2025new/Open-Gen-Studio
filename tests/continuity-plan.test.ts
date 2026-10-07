import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { proposePlanSchema } from '../src/engine/agent/tools';
import { readGuide, workflowById } from '../src/engine/skills';
const models = await local.listModels(undefined);
const ctx: PlanContext = {
  workspace: 'chat', getModel: async ref => { const model = models.find(m => m.ref === ref); return model ? { model, schema: await local.loadSchema(model, undefined) } : null; },
  defaultModel: kind => kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF,
  defaultSettings: () => ({}), asset: id => id === 'original' ? { kind: 'image', width: 400, height: 400 } : undefined, layer: () => undefined,
};
describe('continuity survives tool parsing and normalizer approval', () => {
  it.each(['personaje', 'edificio', 'producto'])('%s: rejects missing inputs and retains the corrected contract without extra steps or saving', async preserve => {
    const raw = { continuity: [{ source: 'asset:original', preserve, steps: ['a', 'b'] }], steps: [{ id: 'a', kind: 'image', prompt: 'First view' }, { id: 'b', kind: 'image', prompt: 'Another view' }] };
    const rejected = await normalizePlan(proposePlanSchema.parse(raw), ctx, 'p');
    expect(rejected.plan).toBeNull(); expect(rejected.errors.join(' ')).toContain('continuity:');
    const repaired = await normalizePlan(proposePlanSchema.parse({ ...raw, steps: raw.steps.map(s => ({ ...s, refs: ['asset:original'] })) }), ctx, 'p');
    expect(repaired.errors).toEqual([]);
    expect(repaired.plan?.continuity).toEqual(raw.continuity);
    expect(repaired.plan?.steps).toHaveLength(2);
    expect(repaired.plan?.subjects).toBeUndefined();
  });
  it('keeps legacy independent plans executable and rejects unknown sources', async () => {
    const steps = [{ id: 'a', kind: 'image', prompt: 'One independent image' }];
    expect((await normalizePlan({ steps }, ctx, 'p')).plan).not.toBeNull();
    expect((await normalizePlan({ steps, continuity: [{ source: 'asset:missing', preserve: 'identity', steps: ['a'] }] }, ctx, 'p')).plan).toBeNull();
  });
  it('states the common policy in every domain and closes with the same check', () => {
    for (const id of ['story', 'product-pack', 'archviz-render']) {
      expect(workflowById(id)).toBeDefined();
      const guide = readGuide(`workflow:${id}`)!;
      expect(guide).toContain('continuity: [{source, preserve, steps}]');
      expect(guide).not.toContain('a clip with no image of her repeats');
      expect(guide).toContain('Before propose_plan: check the declared preservation sources');
    }
    const story = workflowById('story')!;
    expect(story.steps.find(s => s.id === 's2')?.refs).toEqual(['s1']);
    expect(story.steps.find(s => s.id === 's4')?.firstFrame).toBe('s2');
  });
});
