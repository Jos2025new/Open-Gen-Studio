// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
const retryMock = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../src/engine/jobs', async (orig) => ({
  ...(await orig<typeof import('../src/engine/jobs')>()),
  retryGeneration: retryMock,
}));

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { GenerationRecovery } from '../src/components/chat/RecoveryActions';
import { useStore } from '../src/store/store';
import type { Generation } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  retryMock.mockClear();
  const st = useStore.getState();
  useStore.setState({ settings: { ...st.settings, budgetOn: false } });
});

describe('uncertain send recovery requires explicit resend confirmation', () => {
  it('asks for explicit confirmation before calling retryGeneration (and never uses native confirm)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const g = {
      id: 'g_uncertain',
      sessionId: useStore.getState().activeSessionId,
      kind: 'image',
      prompt: 'a',
      modelRef: 'nanogpt::seed',
      modelName: 'Seed',
      provider: 'nanogpt',
      settings: { count: 1, advanced: {} },
      inputs: { refs: [] },
      origin: 'composer',
      status: 'error',
      error: 'Interrupted by a page reload',
      lostJob: true,
      sends: [{ id: 'r0', index: 0, status: 'uncertain' }],
      assetIds: [],
      estimate: { usd: 0.1, approximate: false },
      createdAt: 1,
    } as Generation;

    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const root = createRoot(host);
    act(() => root.render(createElement(GenerationRecovery, { g })));

    const buttons = () => [...host.querySelectorAll('button')];
    const retryBtn = buttons().find((b) => /Retry/.test(b.textContent ?? ''))!;
    expect(retryBtn).toBeTruthy();

    // First click asks for explicit confirmation instead of resending immediately.
    act(() => retryBtn.click());
    expect(retryMock).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/May have been charged/);

    // Cancel dismisses without resending.
    const cancelBtn = buttons().find((b) => /Cancel/.test(b.textContent ?? ''))!;
    act(() => cancelBtn.click());
    expect(retryMock).not.toHaveBeenCalled();

    // Explicit approval sends once.
    act(() => buttons().find((b) => /Retry/.test(b.textContent ?? ''))!.click());
    act(() => buttons().find((b) => /Resend anyway/.test(b.textContent ?? ''))!.click());
    expect(retryMock).toHaveBeenCalledTimes(1);
    expect(retryMock).toHaveBeenCalledWith('g_uncertain', undefined, undefined, true);
  });

  it('over-limit Don’t ask again on an uncertain generation still requires explicit confirmation before mutating session or resending', () => {
    const st = useStore.getState();
    const sid = st.activeSessionId;
    useStore.setState({ settings: { ...st.settings, budgetOn: true, budgetUsd: 0.05 } });
    const g = {
      id: 'g_uncertain_over',
      sessionId: sid,
      kind: 'image',
      prompt: 'a',
      modelRef: 'nanogpt::seed',
      modelName: 'Seed',
      provider: 'nanogpt',
      settings: { count: 1, advanced: {} },
      inputs: { refs: [] },
      origin: 'composer',
      status: 'error',
      error: 'Interrupted',
      lostJob: true,
      sends: [{ id: 'r0', index: 0, status: 'uncertain' }],
      assetIds: [],
      estimate: { usd: 0.5, approximate: false },
      createdAt: 1,
    } as Generation;

    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const root = createRoot(host);
    act(() => root.render(createElement(GenerationRecovery, { g })));

    const buttons = () => [...host.querySelectorAll('button')];
    act(() => buttons().find((b) => /Don’t ask again/.test(b.textContent ?? ''))!.click());
    expect(retryMock).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/May have been charged/);
    expect(useStore.getState().sessions[sid].noAskOverLimit).toBeFalsy();

    act(() => buttons().find((b) => /Cancel/.test(b.textContent ?? ''))!.click());
    expect(retryMock).not.toHaveBeenCalled();
    expect(useStore.getState().sessions[sid].noAskOverLimit).toBeFalsy();

    act(() => buttons().find((b) => /Don’t ask again/.test(b.textContent ?? ''))!.click());
    act(() => buttons().find((b) => /Resend anyway/.test(b.textContent ?? ''))!.click());
    expect(useStore.getState().sessions[sid].noAskOverLimit).toBe(true);
    expect(retryMock).toHaveBeenCalledTimes(1);
    expect(retryMock).toHaveBeenCalledWith('g_uncertain_over', undefined, undefined, true);
  });
});
