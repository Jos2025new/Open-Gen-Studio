import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { deleteSession, subjectFromAsset } from '../src/engine/actions';
import { legacySubjects, newSession, useStore } from '../src/store/store';
import type { Asset, MediaKind, Session } from '../src/engine/types';

const models = await local.listModels(undefined);
const ctx = (names: string[] = []): PlanContext => ({
  workspace: 'node',
  getModel: async (ref) => {
    const model = models.find((m) => m.ref === ref);
    return model ? { model, schema: await local.loadSchema(model, undefined) } : null;
  },
  defaultModel: (kind: MediaKind) => (kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF),
  defaultSettings: () => ({}),
  asset: () => undefined,
  layer: () => undefined,
  subjectNames: () => names,
});

describe('global library', () => {
  it('copies subjects of older sessions once, first name wins', () => {
    const s = (subjects: Session['subjects']) => ({ subjects }) as Session;
    const lib = legacySubjects({ a: s([{ id: '1', name: 'Mia', refAssetIds: [] }]), b: s([{ id: '2', name: 'mia', refAssetIds: [] }, { id: '3', name: 'Rex', refAssetIds: [] }]) });
    expect(lib.map((x) => x.id)).toEqual(['1', '3']);
  });

  it('is shared by every session and keeps its images when the session that made them is deleted', () => {
    const first = useStore.getState().activeSessionId;
    const img: Asset = { id: 'hero', kind: 'image', sessionId: first, origin: 'upload', createdAt: 1, stored: true } as Asset;
    const other: Asset = { ...img, id: 'tmp' };
    useStore.setState((st) => ({ library: [], assets: { ...st.assets, hero: img, tmp: other } }));
    expect(subjectFromAsset('hero', 'Hero', 'product')).toMatchObject({ kind: 'product' });
    expect(subjectFromAsset('tmp', 'hero')).toBeNull(); // name taken
    newSession();
    deleteSession(first);
    const st = useStore.getState();
    expect(st.library.map((x) => x.name)).toEqual(['Hero']);
    expect(st.assets.hero).toBeTruthy();
    expect(st.assets.tmp).toBeUndefined();
  });
});

describe('references first in plans', () => {
  it('rejects an @Name that is neither in the library nor saved by the plan; reference syntax passes', async () => {
    const bad = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: '@Ghost in the rain, like @Image1' }] }, ctx(), 'p');
    expect(bad.errors.join()).toMatch(/@Ghost is not in the library/);
    expect(bad.errors.join()).not.toMatch(/@Image1/);
    const ok = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: '@Ghost in the rain, mail me@example.com' }] }, ctx(['ghost']), 'p');
    expect(ok.errors).toEqual([]);
  });

  it('a reference step feeds every scene through its subject, and the plan style reaches every prompt', async () => {
    const { plan, errors } = await normalizePlan(
      {
        style: 'hand-drawn anime, soft cel shading, warm dusk palette',
        subjects: [{ name: 'Kai', kind: 'character', from: 's1' }],
        steps: [
          { id: 's1', kind: 'image', prompt: 'character sheet of Kai: front, side and back on grey' },
          { id: 's2', kind: 'image', prompt: '@Kai on a rooftop' },
          { id: 's3', kind: 'video', prompt: '@Kai jumps', first_frame: 's2' },
        ],
      },
      ctx(),
      'p',
    );
    expect(errors).toEqual([]);
    expect(plan!.subjects).toEqual([{ name: 'Kai', kind: 'character', from: 's1' }]);
    expect(plan!.style).toBe('hand-drawn anime, soft cel shading, warm dusk palette');
    const prompts = plan!.steps.flatMap((s) => ('prompt' in s ? [s.prompt] : []));
    expect(prompts.every((p) => p.endsWith('Style: hand-drawn anime, soft cel shading, warm dusk palette'))).toBe(true);
    expect(plan!.steps.find((s) => s.id === 's2')!.after).toEqual(['s1']);
  });
});
