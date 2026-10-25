import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
// Generations "run" instantly: each yields one image asset named after its step.
vi.mock('../src/engine/jobs', async (orig) => {
  const actual = await orig<typeof import('../src/engine/jobs')>();
  const { useStore } = await import('../src/store/store');
  return {
    ...actual,
    runGeneration: async (id: string) => {
      const g = useStore.getState().generations[id];
      const aid = `img_${g.stepId}`;
      useStore.setState((st) => ({ assets: { ...st.assets, [aid]: { id: aid, kind: 'image', mime: 'image/png', width: 1024, height: 1024, sessionId: g.sessionId, origin: 'agent', stored: true, favorite: false, createdAt: 1 } as never } }));
      return [aid];
    },
  };
});

import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { executeSteps } from '../src/engine/executor';
import { useStore } from '../src/store/store';
import type { MediaKind } from '../src/engine/types';

const models = await local.listModels(undefined);
const ctx = (attached: string[]): PlanContext => ({
  workspace: 'chat',
  getModel: async (ref) => {
    const model = models.find((m) => m.ref === ref);
    return model ? { model, schema: await local.loadSchema(model, undefined) } : null;
  },
  defaultModel: (kind: MediaKind) => (kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF),
  defaultSettings: () => ({}),
  asset: (id) => (['a', 'b', 'c', 'x'].includes(id) ? { kind: 'image', width: 512, height: 512 } : undefined),
  layer: () => undefined,
  requestImages: () => attached,
});

// Session 2026-10-25: the user attached three sheets (@Image1..3); the agent put the previous frame first in s2..s4.
const raw = {
  title: 'Storyboard',
  steps: [
    { id: 's1', kind: 'image', prompt: 'frame one with @Image1 and @Image2 next to @Image3', refs: ['asset:a', 'asset:b', 'asset:c'] },
    { id: 's2', kind: 'image', prompt: 'frame two, same cast', refs: ['s1', 'asset:a', 'asset:b', 'asset:c'] },
    { id: 's3', kind: 'image', prompt: 'frame three, same cast', refs: [{ ref: 's1', role: 'style' }, 'asset:c', 'asset:a', 'asset:b'] },
    { id: 's4', kind: 'image', prompt: 'frame four with only the third sheet', refs: ['s1', 'asset:c', 'asset:x'] },
  ],
};

describe('the user numbering of attached images holds in every step', () => {
  it('lists the attached images first, in attachment order, then what the plan adds', async () => {
    const { plan, errors } = await normalizePlan(structuredClone(raw) as never, ctx(['a', 'b', 'c']), 'p');
    expect(errors).toEqual([]);
    const refs = (id: string) => (plan!.steps.find((s) => s.id === id) as { refs: string[] }).refs;
    expect(refs('s1')).toEqual(['asset:a', 'asset:b', 'asset:c']);
    expect(refs('s2')).toEqual(['asset:a', 'asset:b', 'asset:c', 's1']);
    expect(refs('s3')).toEqual(['asset:a', 'asset:b', 'asset:c', 's1']);
    // A step that uses only some of them keeps their relative order (the writer cites each with its own @ImageN).
    expect(refs('s4')).toEqual(['asset:c', 's1', 'asset:x']);
  });

  it('leaves the agent order alone when the user attached nothing', async () => {
    const { plan } = await normalizePlan(structuredClone(raw) as never, ctx([]), 'p');
    expect((plan!.steps.find((s) => s.id === 's2') as { refs: string[] }).refs).toEqual(['s1', 'asset:a', 'asset:b', 'asset:c']);
  });

  it('sends the images to the provider in that order', async () => {
    useStore.setState((st) => {
      const mk = (id: string) => ({ id, kind: 'image', mime: 'image/png', width: 512, height: 512, sessionId: st.activeSessionId, origin: 'upload', stored: true, favorite: false, createdAt: 1 }) as never;
      return { generations: {}, assets: { ...st.assets, a: mk('a'), b: mk('b'), c: mk('c'), x: mk('x') } };
    });
    const { plan } = await normalizePlan(structuredClone(raw) as never, ctx(['a', 'b', 'c']), 'p');
    const result = await executeSteps(plan!.steps, { sessionId: useStore.getState().activeSessionId, workspace: 'chat', origin: 'agent', onState: () => undefined });
    expect(result.failed).toEqual([]);
    const sent = (id: string) => Object.values(useStore.getState().generations).find((g) => g.stepId === id)!.inputs.refs;
    expect(sent('s1')).toEqual(['a', 'b', 'c']);
    expect(sent('s2')).toEqual(['a', 'b', 'c', 'img_s1']);
    expect(sent('s3')).toEqual(['a', 'b', 'c', 'img_s1']);
  });
});
