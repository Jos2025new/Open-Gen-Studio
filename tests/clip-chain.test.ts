import { describe, expect, it } from 'vitest';
import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { normalizePlan, stepDeps, type PlanContext } from '../src/engine/plan';
import type { MediaKind, OpStep, VideoStep } from '../src/engine/types';

const models = await local.listModels(undefined);
const ctx: PlanContext = {
  workspace: 'chat',
  getModel: async (ref) => {
    const model = models.find((m) => m.ref === ref);
    return model ? { model, schema: await local.loadSchema(model, undefined) } : null;
  },
  defaultModel: (kind: MediaKind) => (kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF),
  defaultSettings: () => ({}),
  asset: (id) => (id === 'clip' ? { kind: 'video' } : undefined),
  layer: () => undefined,
};

describe('clip → clip chaining is repaired, not rejected (O1)', () => {
  it('a clip as first_frame becomes its last frame, a free local step, noted as an adjustment', async () => {
    const { plan, errors } = await normalizePlan(
      {
        steps: [
          { id: 's1', kind: 'video', prompt: 'she opens the door' },
          { id: 's2', kind: 'video', prompt: 'she walks in', first_frame: 's1' },
          { id: 's3', kind: 'video', prompt: 'she sits', first_frame: 's1' },
        ],
      },
      ctx,
      'p',
    );
    expect(errors).toEqual([]);
    const frame = plan!.steps.find((s) => s.id === 's2_last') as OpStep;
    expect(frame).toMatchObject({ kind: 'op', op: 'extract_frame', input: 's1', params: { which: 'last' } });
    expect((plan!.steps.find((s) => s.id === 's2') as VideoStep).firstFrame).toBe('s2_last');
    // The same clip's frame is extracted once.
    expect((plan!.steps.find((s) => s.id === 's3') as VideoStep).firstFrame).toBe('s2_last');
    expect(plan!.steps.filter((s) => s.kind === 'op')).toHaveLength(1);
    expect(stepDeps(plan!.steps.find((s) => s.id === 's2')!)).toContain('s2_last');
    expect(plan!.adjustments.join(' ')).toMatch(/s2: first_frame s1 is a clip → its last frame/);
  });

  it('a video ref on a model without video inputs becomes its last frame', async () => {
    const { plan, errors } = await normalizePlan({ steps: [{ id: 's1', kind: 'video', prompt: 'continue the shot', refs: ['asset:clip'] }] }, ctx, 'p');
    expect(errors).toEqual([]);
    expect(plan!.steps.find((s) => s.id === 's1_last')).toMatchObject({ op: 'extract_frame', input: 'asset:clip' });
    expect((plan!.steps.find((s) => s.id === 's1') as VideoStep).refs).toEqual(['s1_last']);
    expect(plan!.adjustments.join(' ')).toMatch(/reference video → its last frame/);
  });

  it('a clip as last_frame becomes its first frame', async () => {
    const { plan, errors } = await normalizePlan({ steps: [{ id: 's1', kind: 'video', prompt: 'a' }, { id: 's2', kind: 'video', prompt: 'b', last_frame: 's1' }] }, ctx, 'p');
    // The local video model has no last-frame input: the repair runs, the model check still applies.
    expect(errors.join(' ')).toMatch(/does not support last_frame/);
    expect(errors.join(' ')).not.toMatch(/an image is required/);
    void plan;
  });
});

describe('validator errors carry the exact fix (O2)', () => {
  it('says what to write instead', async () => {
    const many = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: 'x', refs: ['asset:a', 'asset:b', 'asset:c', 'asset:d', 'asset:e'] }] }, { ...ctx, asset: () => ({ kind: 'image' }) }, 'p');
    expect(many.errors.join(' ')).toMatch(/Fix: refs: \["asset:a", "asset:b", "asset:c", "asset:d"\] \(drop asset:e\)/);
    const video = await normalizePlan({ steps: [{ id: 's1', kind: 'video', prompt: 'x', model: LOCAL_VIDEO_REF, refs: ['asset:a', 'asset:b'] }] }, { ...ctx, asset: () => ({ kind: 'image' }) }, 'p');
    expect(video.errors.join(' ')).toMatch(/Fix: drop asset:b from refs/);
    const typo = await normalizePlan({ steps: [{ id: 's1', kind: 'video', prompt: 'x', first_frame: 's9' }] }, ctx, 'p');
    expect(typo.errors.join(' ')).toMatch(/unknown step "s9". Fix: use one of the plan's step ids \(s1\)/);
  });
});
