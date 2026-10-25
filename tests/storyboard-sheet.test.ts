import { describe, expect, it } from 'vitest';
import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { videoFix } from '../src/engine/planFix';
import type { MediaKind } from '../src/engine/types';

/*
 * A storyboard or panel sheet only guides the shots. As a start image the clip opens on the sheet itself (sandbox,
 * 2026-10-24: Seedance 2.0 Mini 480p, three images, the sheet sent as first_frame). User: «un storyboard no tiene
 * sentido como imagen de inicio».
 */
const models = await local.listModels(undefined);
const ctx: PlanContext = {
  workspace: 'chat',
  getModel: async (ref) => {
    const model = models.find((m) => m.ref === ref);
    return model ? { model, schema: await local.loadSchema(model, undefined) } : null;
  },
  defaultModel: (kind: MediaKind) => (kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF),
  defaultSettings: () => ({}),
  asset: (id) => (id === 'sheet' || id === 'girl' ? { kind: 'image' } : undefined),
  layer: () => undefined,
};
const plan = (step: Record<string, unknown>) => normalizePlan({ steps: [{ id: 's1', kind: 'video', prompt: 'two girls run in a park', ...step }] }, ctx, 'p');

describe('storyboard sheet: never the start image', () => {
  it('the sheet as first_frame is refused with the ways out', async () => {
    const { errors } = await plan({ first_frame: 'asset:sheet', storyboard: 'asset:sheet' });
    expect(errors.join(' ')).toMatch(/storyboard sheet: as a start or end frame the clip would open on the sheet/);
    expect(errors.join(' ')).toMatch(/grid_split/);
  });
  it('another image as first_frame, the sheet marked: no refusal for the sheet', async () => {
    const { errors } = await plan({ first_frame: 'asset:girl', storyboard: 'asset:sheet' });
    expect(errors.join(' ')).not.toMatch(/storyboard sheet/);
  });
  it('the fix for a start-image-only model no longer says "the first image": never a storyboard sheet', () => {
    expect(videoFix({ firstFrame: { key: 'image', format: 'url' } } as never, { images: ['asset:sheet', 'asset:girl'], videos: [] }, false)).toMatch(/never a storyboard sheet/);
  });
});
