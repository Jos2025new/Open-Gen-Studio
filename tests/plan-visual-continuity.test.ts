import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { normalizePlan, type PlanContext, type RawPlan, type RawStep } from '../src/engine/plan';
import type { Subject } from '../src/engine/types';

const models = await local.listModels(undefined);
const librarySubject: Subject = { id: 'library-ro', name: 'Reto', kind: 'character', frontalAssetId: 'library-image', refAssetIds: [] };
const ctx = (overrides: Partial<PlanContext> = {}): PlanContext => ({
  workspace: 'chat',
  getModel: async (ref) => {
    const model = models.find((candidate) => candidate.ref === ref);
    if (!model) return null;
    const schema = await local.loadSchema(model, undefined);
    if (ref === LOCAL_VIDEO_REF) schema.slots.shots = { key: 'shots', max: 6, indexed: false, durationAsString: false, exclusivePrompt: false };
    return { model, schema };
  },
  defaultModel: (kind) => kind === 'image' ? LOCAL_IMAGE_REF : kind === 'video' ? LOCAL_VIDEO_REF : null,
  defaultSettings: () => ({}),
  asset: (id) => ['original', 'library-image', 'library-alt', 'other-source'].includes(id) ? { kind: 'image', width: 512, height: 512 } : id === 'wrong-kind' ? { kind: 'audio' } : undefined,
  layer: () => undefined,
  strictContinuity: true,
  ...overrides,
});

const image = (id: string, prompt: string, refs: string[] = []): RawStep => ({ id, kind: 'image', prompt, refs });
const continuity = (source = 'asset:original', steps = ['b', 'c']) => [{ source, preserve: 'Reto identity and clothing', steps }];
const newSubject = { name: 'Reto', from: 'asset:original', description: 'person with a red scarf' };

describe('recurring visual continuity in proposed plans', () => {
  it('requires source-backed continuity for every repeated temporary subject consumer', async () => {
    const steps: RawStep[] = [image('b', '@Reto walks', ['asset:original']), image('c', '@reto turns', ['asset:original']), image('d', '@RETO waves', ['asset:original'])];
    const missing = await normalizePlan({ subjects: [newSubject], steps }, ctx(), 'p');
    expect(missing.plan).toBeNull();
    expect(missing.errors.join(' ')).toMatch(/@reto.*(?:all consuming steps|d)/i);

    const declared = await normalizePlan({ subjects: [newSubject], continuity: continuity('asset:original', ['b', 'c']), steps }, ctx(), 'p');
    expect(declared.plan).toBeNull();
    expect(declared.errors.join(' ').toLowerCase()).toContain('d');

    const complete = await normalizePlan({ subjects: [newSubject], continuity: continuity('asset:original', ['b', 'c', 'd']), steps }, ctx(), 'p');
    expect(complete.errors).toEqual([]);
    expect(complete.plan?.continuity?.[0].steps).toEqual(['b', 'c', 'd']);
  });

  it('uses existing library sources case-insensitively and catches mentions inside structured shots', async () => {
    const steps: RawStep[] = [
      { id: 'b', kind: 'video', model: LOCAL_VIDEO_REF, duration: 8, first_frame: 'asset:library-image', shots: [{ prompt: '@rEtO walks into frame', duration: 4 }, { prompt: 'camera holds', duration: 4 }] },
      { id: 'c', kind: 'video', model: LOCAL_VIDEO_REF, duration: 8, first_frame: 'asset:library-image', shots: [{ prompt: '@RETO turns toward camera', duration: 8 }] },
    ];
    const base = { steps };
    const bad = await normalizePlan(base, ctx({ librarySubjects: () => [librarySubject] }), 'p');
    expect(bad.plan).toBeNull();
    expect(bad.errors.join(' ')).toMatch(/Reto.*b.*c|Reto.*continuity/i);

    const good = await normalizePlan({ ...base, continuity: continuity('asset:library-image', ['b', 'c']) }, ctx({ librarySubjects: () => [librarySubject] }), 'p');
    expect(good.errors).toEqual([]);
  });

  it('accepts an explicitly declared alternate library reference and keeps identities on their own sources', async () => {
    const reto: Subject = { ...librarySubject, refAssetIds: ['library-alt'] };
    const alternate = await normalizePlan({
      continuity: continuity('asset:library-alt', ['b', 'c']),
      steps: [image('b', '@RETO walks', ['asset:library-alt']), image('c', '@reto turns', ['asset:library-alt'])],
    }, ctx({ librarySubjects: () => [reto] }), 'p');
    expect(alternate.errors).toEqual([]);

    const implicitAlternate = await normalizePlan({
      continuity: continuity('asset:library-alt', ['b', 'c']),
      steps: [image('b', '@RETO walks'), image('c', '@reto turns')],
    }, ctx({ librarySubjects: () => [reto] }), 'p');
    expect(implicitAlternate.plan).toBeNull();

    const lila: Subject = { id: 'library-lila', name: 'Lila', kind: 'character', frontalAssetId: 'other-source', refAssetIds: [] };
    const twoSubjects = await normalizePlan({
      subjects: [{ name: 'Reto', from: 'asset:original' }, { name: 'Lila', from: 'asset:other-source' }],
      continuity: [
        { source: 'asset:original', preserve: 'Reto identity', steps: ['b', 'd'] },
        { source: 'asset:other-source', preserve: 'Lila identity', steps: ['c', 'e'] },
      ],
      steps: [
        image('b', '@Reto walks', ['asset:original']), image('c', '@Lila enters', ['asset:other-source']),
        image('d', '@reto turns', ['asset:original']), image('e', '@LILA waves', ['asset:other-source']),
      ],
    }, ctx({ librarySubjects: () => [librarySubject, lila] }), 'p');
    expect(twoSubjects.errors).toEqual([]);
  });

  it('only treats a library mention as a transported source when the model can receive it', async () => {
    const videoSteps: RawStep[] = [
      { id: 'b', kind: 'video', model: LOCAL_VIDEO_REF, duration: 8, shots: [{ prompt: '@Reto walks', duration: 8 }] },
      { id: 'c', kind: 'video', model: LOCAL_VIDEO_REF, duration: 8, shots: [{ prompt: '@reto turns', duration: 8 }] },
    ];
    const group = continuity('asset:library-image', ['b', 'c']);
    const noTransport = await normalizePlan({ continuity: group, steps: videoSteps }, ctx({ librarySubjects: () => [librarySubject] }), 'p');
    expect(noTransport.plan).toBeNull();

    const explicitFrame = await normalizePlan({
      continuity: group,
      steps: videoSteps.map((step) => ({ ...step, first_frame: 'asset:library-image' })),
    }, ctx({ librarySubjects: () => [librarySubject] }), 'p');
    expect(explicitFrame.errors).toEqual([]);

    // This fixture model has a native image-reference slot, so the runner can transport the library frontal for @Name.
    const nativeRefs = await normalizePlan({
      continuity: continuity('asset:library-image', ['b', 'c']),
      steps: [image('b', '@Reto walks'), image('c', '@reto turns')],
    }, ctx({ librarySubjects: () => [librarySubject] }), 'p');
    expect(nativeRefs.errors).toEqual([]);

    const keyframeCtx = ctx({
      librarySubjects: () => [librarySubject],
      getModel: async (ref) => {
        const model = models.find((candidate) => candidate.ref === ref);
        if (!model) return null;
        const schema = await local.loadSchema(model, undefined);
        schema.slots.images = { key: 'refs', max: 4, min: 0, multiple: true, format: 'data-url' };
        schema.slots.keyframes = { key: 'keyframes', max: 4, min: 1, imageKey: 'url', indexKey: 'frame', fps: 24 };
        return { model, schema };
      },
    });
    const keyframeOnly = await normalizePlan({
      continuity: group,
      steps: videoSteps,
    }, keyframeCtx, 'p');
    expect(keyframeOnly.plan).toBeNull();
    const keyframeWithSource = await normalizePlan({
      continuity: group,
      steps: videoSteps.map((step) => ({ ...step, first_frame: 'asset:library-image' })),
    }, keyframeCtx, 'p');
    expect(keyframeWithSource.errors).toEqual([]);
  });

  it('rejects a declared source whose media kind cannot reach its consumers', async () => {
    const steps: RawStep[] = [image('b', '@Reto smile', ['asset:wrong-kind']), image('c', '@Reto waves', ['asset:wrong-kind'])];
    const result = await normalizePlan({ subjects: [newSubject], continuity: continuity('asset:wrong-kind', ['b', 'c']), steps }, ctx(), 'p');
    expect(result.plan).toBeNull();
    expect(result.errors.join(' ')).toMatch(/image|kind|compatible|continuity/i);
  });

  it('leaves independent results, single mentions, and legacy plans outside the new requirement', async () => {
    const independent = await normalizePlan({ steps: [image('b', 'An empty red room'), image('c', 'A blue bicycle')] }, ctx(), 'p');
    expect(independent.plan).not.toBeNull();
    const single = await normalizePlan({ subjects: [newSubject], steps: [image('b', '@Reto walks', ['asset:original'])] }, ctx(), 'p');
    expect(single.plan).not.toBeNull();
    const legacy = await normalizePlan({ subjects: [newSubject], steps: [image('b', '@Reto walks', ['asset:original']), image('c', '@Reto turns', ['asset:original'])] }, ctx({ strictContinuity: false }), 'p');
    expect(legacy.plan).not.toBeNull();
  });

  it('adds a shared style once to top-level and shot prompts without mutating the raw plan', async () => {
    const raw: RawPlan = {
      style: 'flat ink illustration, limited palette',
      steps: [
        image('a', 'A paper kite on a hill'),
        { id: 'b', kind: 'video', model: LOCAL_VIDEO_REF, duration: 8, first_frame: 'asset:original', prompt: 'A kite catches wind', shots: [{ prompt: 'A close view of the string', duration: 4 }, { prompt: 'flat ink illustration, limited palette; the kite settles', duration: 4 }] },
      ],
    };
    const before = structuredClone(raw);
    const result = await normalizePlan(raw, ctx({ strictContinuity: false }), 'p');
    expect(result.errors).toEqual([]);
    const video = result.plan?.steps.find((step) => step.id === 'b');
    expect(video?.kind).toBe('video');
    if (video?.kind !== 'video') throw new Error('expected a video step');
    expect(video.prompt.match(/flat ink illustration, limited palette/g)).toHaveLength(1);
    expect(video.settings.shots?.[0].prompt.match(/flat ink illustration, limited palette/g)).toHaveLength(1);
    expect(video.settings.shots?.[1].prompt.match(/flat ink illustration, limited palette/g)).toHaveLength(1);
    expect(raw).toEqual(before);
  });
});
