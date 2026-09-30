import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
// Generations "run" instantly: each yields one image asset named after its step, so no provider or canvas is needed.
vi.mock('../src/engine/jobs', async (orig) => {
  const actual = await orig<typeof import('../src/engine/jobs')>();
  const { useStore } = await import('../src/store/store');
  return {
    ...actual,
    runGeneration: async (id: string) => {
      const g = useStore.getState().generations[id];
      const aid = `img_${g.stepId}`;
      useStore.setState((st) => ({ assets: { ...st.assets, [aid]: { id: aid, kind: 'image', mime: 'image/png', width: 1920, height: 1080, sessionId: g.sessionId, origin: 'agent', stored: true, favorite: false, createdAt: 1 } as never } }));
      return [aid];
    },
  };
});

import { executeSteps } from '../src/engine/executor';
import { libraryItem, subjectFromAsset } from '../src/engine/actions';
import { OPS, opCount, sheetLayout } from '../src/engine/ops';
import { preferredResolution } from '../src/engine/params';
import { useStore } from '../src/store/store';
import type { PlanStep } from '../src/engine/types';

const img = (id: string) => ({ id, kind: 'image', mime: 'image/png', width: 1024, height: 1024, sessionId: useStore.getState().activeSessionId, origin: 'upload', stored: true, favorite: false, createdAt: 1 }) as never;

describe('reference sheet candidates', () => {
  it('a subject made by a step serves this plan as @Name but is not saved to the library', async () => {
    useStore.setState({ library: [] });
    const sid = useStore.getState().activeSessionId;
    const steps: PlanStep[] = [
      { id: 's1', kind: 'image', title: 'sheet', prompt: 'turnaround sheet', modelRef: 'local::sketch', settings: { count: 1, advanced: {} }, refs: [] },
      { id: 's2', kind: 'image', title: 'scene', prompt: '@Kai on a rooftop', modelRef: 'local::sketch', settings: { count: 1, advanced: {} }, refs: [], after: ['s1'] },
    ];
    const gens: string[] = [];
    await executeSteps(steps, {
      sessionId: sid,
      workspace: 'chat',
      origin: 'agent',
      subjects: [{ name: 'Kai', kind: 'character', from: 's1' }],
      onState: (_id, _st, info) => info?.generationId && gens.push(info.generationId),
    });
    const st = useStore.getState();
    expect(st.library).toEqual([]);
    const scene = Object.values(st.generations).find((g) => g.stepId === 's2')!;
    expect(scene.inputs.subjects).toMatchObject([{ name: 'Kai', kind: 'character', frontalAssetId: 'img_s1' }]);
    const sheet = Object.values(st.generations).find((g) => g.stepId === 's1')!;
    expect(sheet.inputs.subjects).toBeUndefined();
  });
});

describe('saving to the shared library', () => {
  it('refuses a taken name unless replace is confirmed; replacing keeps its id and @Name', () => {
    useStore.setState((st) => ({ library: [], assets: { ...st.assets, a1: img('a1'), a2: img('a2'), v1: img('v1'), v2: img('v2') } }));
    const first = subjectFromAsset('a1', 'Kai', 'character')!;
    expect(subjectFromAsset('a2', 'kai', 'character')).toBeNull();
    const again = subjectFromAsset('a2', 'kai', 'location', { replace: true, views: ['v1', 'v2'] })!;
    expect(again).toMatchObject({ id: first.id, name: 'Kai', kind: 'location', frontalAssetId: 'v1', refAssetIds: ['v2'] });
    expect(useStore.getState().library).toHaveLength(1);
    expect(libraryItem('@KAI')?.id).toBe(first.id);
  });
});

describe('reference_sheet op', () => {
  it('is always a 2×2 grid, with panels by subject and sheet type, and 1–4 candidates', () => {
    const op = OPS.reference_sheet;
    const text = (p: Record<string, string>) => op.instruction!({ subject: 'character', sheet: 'turnaround', aspect: '16:9', count: '1', note: '', ...p });
    expect(text({})).toMatch(/2×2 grid/);
    expect(text({})).toMatch(/face close-up/);
    expect(text({ subject: 'location' })).toMatch(/top-down plan view/);
    expect(text({ subject: 'object' })).toMatch(/front.*side.*back.*top-down/);
    expect(sheetLayout('character', 'expressions')).toMatch(/expressions/);
    expect(opCount(op, { count: '3' })).toBe(3);
    expect(opCount(op, {})).toBe(1);
  });

  it('prefers 2K, then the nearest size below, and sends nothing without sizes', () => {
    expect(preferredResolution(['1K', '2K', '4K'], '2K')).toBe('2K');
    expect(preferredResolution(['512', '1K'], '2K')).toBe('1K');
    expect(preferredResolution(['4K'], '2K')).toBe('4K');
    expect(preferredResolution(['auto', 'standard'], '2K')).toBeUndefined();
  });
});
