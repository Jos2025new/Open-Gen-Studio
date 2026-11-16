import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { blobs, writes } = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), writes: { corruptNext: '' } }));
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async (id: string) => blobs.get(id),
  putAssetBlob: async (id: string, b: Blob) => { if (writes.corruptNext === id) { writes.corruptNext = ''; blobs.set(id, new Blob(['corrupt-bytes'])); } else blobs.set(id, b); return `blob:${id}`; },
  deleteAssetBlobs: async (ids: string[]) => ids.forEach((id) => blobs.delete(id)),
}));

import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { deleteSession, subjectFromAsset } from '../src/engine/actions';
import { beginAssetEdit, jumpToAssetRevision, normalizeAssetRevisions, redoAssetRevision, revertAssetToOriginal, saveAssetEdit, undoAssetRevision } from '../src/engine/assetRevisions';
import { persistState } from '../src/store/persistJson';
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
    expect(useStore.getState().assets.hero.revisions).toBeUndefined();
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');
    expect(await blobs.get(copied!.id)?.text()).toBe('edited-bytes');

    // 3. «Guardar» ('original') appends versions [Original, Pintura] and moves revisionIndex to 1.
    const applied = await saveAssetEdit('hero', editedBlob, 'original', { width: 240, height: 160 });
    expect(applied?.id).toBe('hero');
    expect(useStore.getState().assets.hero.width).toBe(240);
    expect(useStore.getState().assets.hero.revisionIndex).toBe(1);
    expect(useStore.getState().assets.hero.revisions?.map((r) => r.label)).toEqual(['Original', 'Pintura']);
    expect(await blobs.get('hero')?.text()).toBe('edited-bytes');

    // 4. Undo / Redo / jump to original never delete any version, and saving from an older version appends at the end.
    expect(await undoAssetRevision('hero')).toBe(true);
    expect(useStore.getState().assets.hero.revisionIndex).toBe(0);
    expect(useStore.getState().assets.hero.width).toBe(120);
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');

    expect(await redoAssetRevision('hero')).toBe(true);
    expect(useStore.getState().assets.hero.revisionIndex).toBe(1);
    expect(useStore.getState().assets.hero.width).toBe(240);
    expect(await blobs.get('hero')?.text()).toBe('edited-bytes');

    // Jump to original (revertAssetToOriginal = jump to 0), then redo still works.
    expect(await revertAssetToOriginal('hero')).toBe(true);
    const restored = useStore.getState().assets.hero;
    expect(restored.width).toBe(120);
    expect(restored.height).toBe(80);
    expect(restored.revisionIndex).toBe(0);
    expect(restored.revisions).toHaveLength(2);
    expect(restored.revertedAt).toBeTypeOf('number');
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');
    expect(await redoAssetRevision('hero')).toBe(true);
    expect(useStore.getState().assets.hero.revisionIndex).toBe(1);
    expect(await blobs.get('hero')?.text()).toBe('edited-bytes');

    // Saving from an older version (index 0) appends v2 at the end without deleting v1.
    expect(await jumpToAssetRevision('hero', 0)).toBe(true);
    const edit2Blob = new Blob(['edited-2-bytes'], { type: 'image/png' });
    const saved2 = await saveAssetEdit('hero', edit2Blob, 'original', { width: 320, height: 240 }, 'Pintura 2');
    expect(saved2?.revisionIndex).toBe(2);
    expect(saved2?.revisions?.map((r) => r.label)).toEqual(['Original', 'Pintura', 'Pintura 2']);
    expect(await blobs.get(saved2!.revisions![1].assetId)?.text()).toBe('edited-bytes');
    expect(await blobs.get('hero')?.text()).toBe('edited-2-bytes');
  });

  it('keeps the displayed bytes and pointer when a jump cannot be verified', async () => {
    const id = 'failed-jump';
    const original = new Blob(['original-bytes']);
    const edit = new Blob(['edited-bytes']);
    blobs.set(id, original);
    useStore.setState((st) => ({ assets: { ...st.assets, [id]: { id, kind: 'image', origin: 'upload', createdAt: 1, stored: true } as Asset } }));
    expect(await saveAssetEdit(id, edit, 'original')).not.toBeNull();
    writes.corruptNext = id;
    expect(await undoAssetRevision(id)).toBe(false);
    expect(useStore.getState().assets[id].revisionIndex).toBe(1);
    expect(await blobs.get(id)?.text()).toBe('edited-bytes');
    blobs.delete(id);
    expect(await undoAssetRevision(id)).toBe(true);
    expect(await blobs.get(id)?.text()).toBe('original-bytes');
  });

  it('migrates legacy originalRevision/revisions in code, persists through SQLite store reload, and handles missing blobs safely', async () => {
    const first = useStore.getState().activeSessionId;
    const origBlob = new Blob(['original-bytes'], { type: 'image/png' });
    const editedBlob = new Blob(['edited-bytes'], { type: 'image/png' });
    blobs.clear();
    const missingOrig: Asset = { id: 'no-blob', kind: 'image', mime: 'image/png', width: 100, height: 100, sessionId: first, origin: 'upload', createdAt: 10, stored: true, favorite: false };
    const intactOrig: Asset = { id: 'hero2', kind: 'image', mime: 'image/png', width: 120, height: 80, sessionId: first, origin: 'upload', createdAt: 10, stored: true, favorite: false };
    blobs.set('hero2', origBlob);
    blobs.set('legacy_orig_blob', new Blob(['legacy-orig'], { type: 'image/png' }));
    blobs.set('legacy1', new Blob(['legacy-edited'], { type: 'image/png' }));
    const legacyAsset: Asset = {
      id: 'legacy1',
      kind: 'image',
      mime: 'image/png',
      width: 200,
      height: 150,
      sessionId: first,
      origin: 'upload',
      createdAt: 10,
      stored: true,
      favorite: false,
      originalRevision: { assetId: 'legacy_orig_blob', width: 100, height: 75, mime: 'image/png', createdAt: 5 },
      revisions: [{ assetId: 'legacy_orig_blob', width: 100, height: 75, mime: 'image/png', createdAt: 5 }],
    };
    useStore.setState((st) => ({
      library: [],
      assets: { ...st.assets, 'no-blob': missingOrig, hero2: intactOrig, legacy1: legacyAsset },
      ui: { ...st.ui, toasts: [] },
    }));

    // Legacy shape normalizes to 2 versions pointing at the latest without losing anything on undo/redo.
    const norm = normalizeAssetRevisions(legacyAsset);
    expect(norm.index).toBe(1);
    expect(norm.versions.map((v) => v.label)).toEqual(['Original', 'Guardado']);
    expect(await undoAssetRevision('legacy1')).toBe(true);
    expect(await blobs.get('legacy1')?.text()).toBe('legacy-orig');
    expect(await redoAssetRevision('legacy1')).toBe(true);
    expect(await blobs.get('legacy1')?.text()).toBe('legacy-edited');

    // 1. Apply refuses when the original blob is missing and leaves asset/blobs untouched.
    const rejected = await saveAssetEdit('no-blob', editedBlob, 'original', { width: 200, height: 200 });
    expect(rejected).toBeNull();
    expect(blobs.get('no-blob')).toBeUndefined();
    expect(useStore.getState().assets['no-blob'].revisions).toBeUndefined();
    expect(useStore.getState().assets['no-blob'].width).toBe(100);
    expect(useStore.getState().ui.toasts.some((t) => t.level === 'success')).toBe(false);

    // 2. Apply succeeds when original blob is saved and verifiable, then Undo fails cleanly if target backup blob is lost.
    const applied = await saveAssetEdit('hero2', editedBlob, 'original', { width: 240, height: 160 });
    expect(applied?.revisions).toHaveLength(2);
    const revId = applied!.revisions![0].assetId;
    expect(await blobs.get(revId)?.text()).toBe('original-bytes');

    blobs.delete(revId);
    useStore.setState((st) => ({ ui: { ...st.ui, toasts: [] } }));
    expect(await undoAssetRevision('hero2')).toBe(false);
    const kept = useStore.getState().assets.hero2;
    expect(kept.revisionIndex).toBe(1);
    expect(kept.width).toBe(240);
    expect(await blobs.get('hero2')?.text()).toBe('edited-bytes');
    expect(useStore.getState().ui.toasts.some((t) => t.level === 'success')).toBe(false);

    // 3. Versions survive SQLite delta store commit + reload and record asset_revisions.
    const { createSqliteStore } = await import('../server/store-sqlite.js');
    const { createDeltaClient } = await import('../server/sqlite/delta-client.mjs');
    const root = mkdtempSync(join(tmpdir(), 'ogs-asset-versions-'));
    try {
      const store1 = createSqliteStore(root);
      const snap1 = persistState({ state: { ...useStore.getState(), assets: { legacy1: useStore.getState().assets.legacy1 } }, version: 1 }).v2!;
      const client = createDeltaClient();
      const sessions1 = Object.fromEntries(snap1.sessions.entries());
      const delta1 = client.diff(JSON.parse(snap1.globals), snap1.order, Object.keys(sessions1));
      const r1 = store1.commit({ savedAt: 1000, baseAt: 0, version: snap1.version, order: snap1.order, sessions: sessions1, delta: delta1 });
      expect(r1.status).toBe(204);
      client.ack();

      await undoAssetRevision('legacy1');
      const snap2 = persistState({ state: { ...useStore.getState(), assets: { legacy1: useStore.getState().assets.legacy1 } }, version: 1 }).v2!;
      const sessions2 = Object.fromEntries(snap2.sessions.entries());
      const delta2 = client.diff(JSON.parse(snap2.globals), snap2.order, Object.keys(sessions2));
      expect(JSON.parse(delta2.up.assets.legacy1).revisionIndex).toBe(0);
      const r2 = store1.commit({ savedAt: 2000, baseAt: 1000, version: snap2.version, order: snap2.order, sessions: sessions2, delta: delta2 });
      expect(r2.status).toBe(204);
      store1.close();

      // Simulate fresh reload from SQLite store.
      const store2 = createSqliteStore(root);
      const loaded = JSON.parse(store2.read()!);
      expect(loaded.state.assets.legacy1.revisionIndex).toBe(0);
      expect(loaded.state.assets.legacy1.revisions).toHaveLength(2);
      useStore.setState((st) => ({ assets: { ...st.assets, legacy1: loaded.state.assets.legacy1 } }));
      expect(await blobs.get('legacy1')?.text()).toBe('legacy-orig');
      expect(await redoAssetRevision('legacy1')).toBe(true);
      expect(await blobs.get('legacy1')?.text()).toBe('legacy-edited');
      expect(store2.readAssetRevisions('legacy1').map((r: { kind: string }) => r.kind)).toEqual(['create', 'revert']);
      store2.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
