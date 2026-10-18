import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import type { MediaKind, PlanStep, VideoStep } from '../src/engine/types';

const models = await local.listModels(undefined);
const ctx = (): PlanContext => ({
  workspace: 'chat',
  getModel: async (ref) => {
    const model = models.find((m) => m.ref === ref);
    return model ? { model, schema: await local.loadSchema(model, undefined) } : null;
  },
  defaultModel: (kind: MediaKind) => (kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF),
  defaultSettings: () => ({}),
  asset: () => undefined,
  layer: () => undefined,
});

const videoStep = (s: PlanStep): VideoStep => {
  if (s.kind !== 'video') throw new Error('expected a video step');
  return s;
};

describe('video steps keep their capture (plan validation path)', () => {
  it('a video step with capture keeps style and directives', async () => {
    const { plan, errors } = await normalizePlan({ title: 'T', steps: [{ id: 's1', kind: 'video', prompt: 'a walk', capture: { style: 'camcorder', directives: ['backwards'] } }] }, ctx(), 'p');
    expect(errors).toEqual([]);
    expect(videoStep(plan!.steps[0]).settings.capture).toMatchObject({ style: 'camcorder', directives: ['backwards'] });
  });
  it('an image-only preset is dropped on a video step', async () => {
    const { plan } = await normalizePlan({ title: 'T', steps: [{ id: 's1', kind: 'video', prompt: 'a walk', capture: { style: 'disposable', directives: ['backwards'] } }] }, ctx(), 'p');
    expect(videoStep(plan!.steps[0]).settings.capture?.style).toBeUndefined();
  });
});

