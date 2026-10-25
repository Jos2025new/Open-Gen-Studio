import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import type { ModelSchema, ModelSummary } from '../src/engine/types';

const ref = 'atlas::video-frame-fixes-test';
const model = { ref, provider: 'atlas', id: 'video-frame-fixes-test', name: 'Frame fixes', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] } as ModelSummary;
const build = async (frameRules: NonNullable<ModelSchema['slots']['frameRules']>, fields: Record<string, unknown>) => {
  const schema: ModelSchema = { ref, source: 'catalog', params: [], slots: {
    prompt: 'prompt', firstFrame: { key: 'start', format: 'url' }, lastFrame: { key: 'end', format: 'url' },
    images: { key: 'refs', max: 4, min: 0, multiple: true, format: 'url' }, frameRules,
  } };
  const context: PlanContext = {
    workspace: 'chat', getModel: async candidate => candidate === ref ? { model, schema } : null,
    defaultModel: () => null, defaultSettings: () => ({}), asset: id => ({ kind: id === 'clip' ? 'video' : 'image', width: 32, height: 32 }), layer: () => undefined,
  };
  return normalizePlan({ title: 'Frame plan', steps: [{ id: 'clip', kind: 'video', prompt: 'move', model: ref, ...fields }] }, context, 'frame-plan');
};

describe('constructive video frame fixes in plan validation', () => {
  it('offers either start frame or refs when the model forbids combining them', async () => {
    const result = await build({ refsWithFirst: false }, { first_frame: 'asset:start', refs: ['asset:ref'] });
    expect(result.errors.join(' ')).toMatch(/drop first_frame.*or.*drop refs/i);
    expect(result.errors.join(' ')).not.toContain('add the missing input');
  });

  it('offers either last frame or refs when the model forbids combining them', async () => {
    const result = await build({ refsWithFirst: false, refsWithLast: false }, { last_frame: 'asset:end', refs: ['asset:ref'] });
    expect(result.errors.join(' ')).toMatch(/drop last_frame.*or.*drop refs/i);
    expect(result.errors.join(' ')).not.toContain('add the missing input');
  });

  it('offers an allowed resolution or no start frame for resolution-specific rules', async () => {
    const result = await build({ firstFrameResolutions: ['720p', '1080p'] }, { first_frame: 'asset:start', resolution: '4k' });
    expect(result.errors.join(' ')).toMatch(/resolution.*720p.*1080p.*drop first_frame/i);
  });

  it('offers adding the start frame when a last frame requires one', async () => {
    const result = await build({ lastNeedsFirst: true }, { last_frame: 'asset:end' });
    expect(result.errors.join(' ')).toMatch(/add first_frame/i);
  });
});
