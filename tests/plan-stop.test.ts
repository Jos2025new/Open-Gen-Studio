// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Cancel on a running plan card stops the whole run: no pending step starts afterwards (money), running ones are
 * cancelled. Nothing reaches a provider: the runner is replaced by one that waits until its generation is cancelled.
 */
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  putAssetBlob: async () => undefined,
}));
const started = vi.hoisted(() => [] as string[]);
vi.mock('../src/engine/jobs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/engine/jobs')>();
  const { useStore } = await import('../src/store/store');
  let n = 0;
  return {
    ...real,
    createGeneration: (spec: Record<string, unknown>) => {
      const id = `gen_${++n}`;
      const g = { id, ...spec, status: 'queued', assetIds: [], createdAt: Date.now(), estimate: { usd: 0.1 }, provider: 'local', modelName: 'Studio Image', inputs: spec.inputs ?? { refs: [] } };
      useStore.setState((st) => ({ generations: { ...st.generations, [id]: g as never } }));
      return g as never;
    },
    // The real one aborts the request's controller, which ends the generation as canceled.
    cancelGeneration: (id: string) => useStore.setState((st) => ({ generations: { ...st.generations, [id]: { ...st.generations[id], status: 'canceled' } } })),
    // A "provider call": it starts, then waits until the generation is cancelled.
    runGeneration: (id: string) => {
      started.push(useStore.getState().generations[id].stepId as string);
      useStore.setState((st) => ({ generations: { ...st.generations, [id]: { ...st.generations[id], status: 'running' } } }));
      return new Promise<string[]>((_, reject) => {
        const off = useStore.subscribe((st) => {
          if (st.generations[id]?.status !== 'canceled') return;
          off();
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    },
  };
});

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PlanCard } from '../src/components/chat/PlanCard';
import { executeSteps } from '../src/engine/executor';
import { finalPlanStatus, isPlanStopped, stopPlanRun } from '../src/engine/planStop';
import { useStore } from '../src/store/store';
import type { ImageStep, PlanFeedItem } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const step = (id: string): ImageStep => ({ id, kind: 'image', title: id, prompt: id, modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, refs: [] });
const sid = () => useStore.getState().activeSessionId;
beforeEach(() => { started.length = 0; });

describe('Cancel on a running plan stops the whole run', () => {
  it('three independent steps, concurrency 2: after Cancel the third never starts and the plan ends canceled', async () => {
    const stepGenerations: Record<string, string> = {};
    const running = executeSteps([step('a'), step('b'), step('c')], {
      sessionId: sid(), planId: 'pl_stop', workspace: 'chat', origin: 'agent', concurrency: 2,
      onState: (id, state, info) => { if (info?.generationId) stepGenerations[id] = info.generationId; void state; },
    });
    await vi.waitFor(() => expect(started).toEqual(['a', 'b']));
    const item = { id: 'p1', createdAt: 0, workspace: 'chat', type: 'plan', style: 'auto', status: 'running', stepStates: { a: 'running', b: 'running' }, stepGenerations, estimate: { usd: 0.3 }, plan: { id: 'pl_stop', title: 'T', workspace: 'chat', adjustments: [], steps: [step('a'), step('b'), step('c')] } } as unknown as PlanFeedItem;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(PlanCard, { item, sessionId: sid() })); });
    const cancel = [...host.querySelectorAll('.plan-foot button')].find((b) => b.textContent === 'Cancel') as HTMLElement;
    await act(async () => { cancel.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(started).toEqual(['a', 'b']);
    const result = await running;
    expect(result.failed.map((f) => f.error)).toEqual(['Canceled', 'Canceled']);
    expect(result.skipped).toEqual(['c']);
    expect(result.waiting).toEqual([]);
    expect(Object.values(useStore.getState().generations).filter((g) => g.stepId === 'c')).toHaveLength(0);
    expect(isPlanStopped('pl_stop')).toBe(true);
    expect(finalPlanStatus(result)).toBe('canceled');
  });

  it('a stop requested before a step starts sending cancels it instead of sending (step preparing its request)', async () => {
    stopPlanRun('pl_pre');
    // executeSteps starts a run clean; the stop arrives after the step is running but before it reaches the runner.
    const result = await executeSteps([step('a')], { sessionId: sid(), planId: 'pl_pre', workspace: 'chat', origin: 'agent', onState: (_id, state) => { if (state === 'running') stopPlanRun('pl_pre'); } });
    expect(started).toEqual([]);
    expect(result.failed.map((f) => f.error)).toEqual(['Canceled']);
    expect(result.stopped).toBe(true);
    expect(finalPlanStatus(result)).toBe('canceled');
  });

  it('a later run of the same plan (retry) is not blocked by an old stop', async () => {
    stopPlanRun('pl_again');
    const run = executeSteps([step('a')], { sessionId: sid(), planId: 'pl_again', workspace: 'chat', origin: 'agent', onState: () => undefined });
    await vi.waitFor(() => expect(started).toEqual(['a']));
    stopPlanRun('pl_again');
    for (const g of Object.values(useStore.getState().generations)) if (g.stepId === 'a') useStore.setState((st) => ({ generations: { ...st.generations, [g.id]: { ...g, status: 'canceled' } } }));
    await run;
  });
});
