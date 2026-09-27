import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { normalizePlan, stepDeps, toggleStep, type PlanContext } from '../src/engine/plan';
import { executeSteps } from '../src/engine/executor';
import { useStore } from '../src/store/store';
import type { MediaKind, PlanStep } from '../src/engine/types';

const models = await local.listModels(undefined);
const ctx = (names: string[] = []): PlanContext => ({
  workspace: 'chat',
  getModel: async (ref) => {
    const model = models.find((m) => m.ref === ref);
    return model ? { model, schema: await local.loadSchema(model, undefined) } : null;
  },
  defaultModel: (kind: MediaKind) => (kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF),
  defaultSettings: () => ({}),
  asset: (id) => (id === 'char' ? { kind: 'image', width: 384, height: 682 } : undefined),
  layer: () => undefined,
  subjectNames: () => names,
});

const story = {
  title: 'Story',
  subjects: [{ name: 'Reto', from: 's1' }],
  steps: [
    { id: 's1', kind: 'image', prompt: 'character sheet of the girl', refs: ['asset:char'] },
    { id: 's2', kind: 'video', prompt: '@Reto opens the door' },
    { id: 's3', kind: 'video', prompt: '@reto runs down the corridor' },
    { id: 's4', kind: 'video', prompt: 'the city at night, no one' },
  ],
};

describe('plan subjects (F3)', () => {
  it('steps that mention the subject wait for the step that makes it', async () => {
    const { plan, errors } = await normalizePlan(structuredClone(story), ctx(), 'p');
    expect(errors).toEqual([]);
    expect(plan!.subjects).toEqual([{ name: 'Reto', from: 's1' }]);
    const deps = Object.fromEntries(plan!.steps.map((s) => [s.id, stepDeps(s)]));
    expect(deps.s2).toContain('s1');
    expect(deps.s3).toContain('s1'); // mentions are case-insensitive, as the app reads them
    expect(deps.s4).not.toContain('s1');
    // Unchecking the subject's image unchecks the clips that need it, not the others.
    expect(toggleStep(plan!.steps, [], 's1')).toEqual(['s1', 's2', 's3']);
  });

  it('rejects a bad name or a non-image source, and reuses an existing subject', async () => {
    const bad = await normalizePlan({ ...structuredClone(story), subjects: [{ name: 'La chica', from: 's1' }, { name: 'Clip', from: 's2' }] }, ctx(), 'p');
    expect(bad.errors.join(' ')).toMatch(/one word/);
    expect(bad.errors.join(' ')).toMatch(/must be an image; "s2" is video/);
    const reuse = await normalizePlan(structuredClone(story), ctx(['reto']), 'p');
    expect(reuse.plan!.adjustments.join(' ')).toMatch(/@Reto already exists in this session: reused/);
  });

  it('an attached image becomes the subject when the plan runs, before any step', async () => {
    const st = useStore.getState();
    const sid = st.activeSessionId;
    useStore.setState({
      assets: { ...st.assets, char: { id: 'char', kind: 'image', mime: 'image/png', width: 384, height: 682, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 } },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], subjects: [] } },
    });
    const steps: PlanStep[] = [{ id: 't1', kind: 'text', title: 'note', text: 'hi' }];
    const seen: string[] = [];
    await executeSteps(steps, {
      sessionId: sid,
      workspace: 'chat',
      origin: 'agent',
      subjects: [{ name: 'Reto', from: 'asset:char' }],
      onState: (id, state) => {
        if (state === 'running') seen.push(`${id}:${useStore.getState().sessions[sid].subjects?.map((x) => x.name).join(',')}`);
      },
    });
    expect(seen).toEqual(['t1:Reto']);
    expect(useStore.getState().sessions[sid].subjects?.[0]).toMatchObject({ name: 'Reto', frontalAssetId: 'char' });
  });
});
