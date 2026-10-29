// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
const resume = vi.hoisted(() => vi.fn(async () => 'ok'));
vi.mock('../src/engine/agent/runtime', async (orig) => ({ ...(await orig<typeof import('../src/engine/agent/runtime')>()), resumePlan: resume }));
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PlanRecoveryChips } from '../src/components/chat/RecoveryActions';
import { useStore } from '../src/store/store';
import type { Generation, ModelSummary, PlanFeedItem } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

// Repro (case 4, H9): a failed plan whose provider job can be checked, with the spending limit already used up.
const ref = 'fal::fal-ai/priced';
const sid = 's';
const item = { id: 'p1', createdAt: 0, workspace: 'chat', type: 'plan', status: 'error', skipped: [], stepStates: { s1: 'error' }, stepGenerations: { s1: 'g1' },
  plan: { id: 'pl', title: 't', workspace: 'chat', steps: [{ id: 's1', kind: 'image', title: 'A', prompt: 'a', modelRef: ref, settings: { count: 1, advanced: {} }, refs: [] }] } } as unknown as PlanFeedItem;

beforeEach(() => {
  resume.mockClear();
  const st = useStore.getState();
  const m = { ref, provider: 'fal', id: 'fal-ai/priced', name: 'p', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ usd: 0.5, unit: 'output' }] } } as unknown as ModelSummary;
  useStore.setState({
    spentUsd: 5,
    generations: { g1: { id: 'g1', status: 'error', kind: 'image', assetIds: [], settings: { count: 1, advanced: {} }, estimate: { usd: 0.5, approximate: false }, remoteJob: { provider: 'fal', id: 'j', meta: {} } } as unknown as Generation },
    catalog: { ...st.catalog, models: { [ref]: m }, schemas: { [ref]: { ref, params: [], source: 'openapi', slots: { prompt: 'prompt' } } } },
    settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k' }, budgetOn: true, budgetUsd: 5, budgetAccepted: null },
  });
});

describe('repro 4 / H9: Check status with the limit used up', () => {
  // Cause: RecoveryActions.tsx:23-30 only accepts the limit for 'retry'; planRun.ts:388 blocks 'check' with a toast, so the card has no way forward.
  // DECISION NEEDED: whether Check status itself should be gated by the limit is not decided; the test asserts only "not a dead end".
  it.fails('pressing Check status either starts it or offers a way to continue', () => {
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const root = createRoot(host);
    act(() => root.render(createElement(PlanRecoveryChips, { sessionId: sid, item })));
    const buttons = () => [...host.querySelectorAll('button')];
    const check = buttons().find((b) => /Check status/.test(b.textContent ?? ''));
    expect(check).toBeTruthy();
    act(() => check!.click());
    const offersContinue = buttons().some((b) => /anyway|continue/i.test(b.textContent ?? '') && !/Retry/.test(b.textContent ?? ''));
    expect(resume.mock.calls.length > 0 || offersContinue).toBe(true);
  });
});
