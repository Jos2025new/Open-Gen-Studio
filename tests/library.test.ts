import { describe, expect, it, vi } from 'vitest';

const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, Blob>() }));
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async (id: string) => blobs.get(id),
  putAssetBlob: async (id: string, b: Blob) => { blobs.set(id, b); return `blob:${id}`; },
  deleteAssetBlobs: async (ids: string[]) => ids.forEach((id) => blobs.delete(id)),
}));

import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { deleteSession, subjectFromAsset } from '../src/engine/actions';
import { beginAssetEdit, revertAssetToOriginal, saveAssetEdit } from '../src/engine/assetRevisions';
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

  it('editing a library asset works on a copy, defaults to Guardar como copia, and Aplicar al original stays recoverable with Revertir', async () => {
    const first = useStore.getState().activeSessionId;
    const origBlob = new Blob(['original-bytes'], { type: 'image/png' });
    const editedBlob = new Blob(['edited-bytes'], { type: 'image/png' });
    blobs.set('hero', origBlob);
    const img: Asset = { id: 'hero', kind: 'image', mime: 'image/png', width: 120, height: 80, sessionId: first, origin: 'upload', createdAt: 10, stored: true, favorite: false };
    useStore.setState((st) => ({ library: [], assets: { ...st.assets, hero: img } }));
    subjectFromAsset('hero', 'Hero', 'character');

    // 1. Editing works on a working copy and leaves the original untouched.
    const working = beginAssetEdit('hero');
    expect(working?.copiedFromAssetId).toBe('hero');
    expect(working?.id).not.toBe('hero');
    expect(useStore.getState().assets.hero.width).toBe(120);
    expect(useStore.getState().ui.sketch).toEqual({ assetId: 'hero', mode: 'paint' });

    // 2. Default save ('copy' / «Guardar como copia») creates a new asset and leaves hero untouched.
    const copied = await saveAssetEdit('hero', editedBlob);
    expect(copied?.id).not.toBe('hero');
    expect(copied?.copiedFromAssetId).toBe('hero');
    expect(useStore.getState().assets.hero.originalRevision).toBeUndefined();
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');
    expect(await blobs.get(copied!.id)?.text()).toBe('edited-bytes');

    // 3. «Aplicar al original» ('original') updates hero in place while preserving originalRevision.
    const applied = await saveAssetEdit('hero', editedBlob, 'original', { width: 240, height: 160 });
    expect(applied?.id).toBe('hero');
    expect(useStore.getState().assets.hero.width).toBe(240);
    expect(useStore.getState().assets.hero.originalRevision).toMatchObject({ width: 120, height: 80 });
    expect(await blobs.get('hero')?.text()).toBe('edited-bytes');

    // 4. «Revertir» restores the original bytes and dimensions while keeping revision history.
    expect(await revertAssetToOriginal('hero')).toBe(true);
    const restored = useStore.getState().assets.hero;
    expect(restored.width).toBe(120);
    expect(restored.height).toBe(80);
    expect(restored.originalRevision).toBeUndefined();
    expect(restored.revisions).toHaveLength(1);
    expect(restored.revertedAt).toBeTypeOf('number');
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');
  });
});

describe('references first in plans', () => {
  it('rejects an @Name that is neither in the library nor saved by the plan; reference syntax passes', async () => {
    const bad = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: '@Ghost in the rain, like @Image1' }] }, ctx(), 'p');
    expect(bad.errors.join()).toMatch(/@Ghost is not in the library/);
    expect(bad.errors.filter((e) => !e.includes('cites')).join()).not.toMatch(/@Image1/);
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
