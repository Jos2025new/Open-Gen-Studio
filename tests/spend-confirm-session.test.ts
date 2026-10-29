// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SpendConfirm } from '../src/components/ui/SpendConfirm';
import { createSession, useStore } from '../src/store/store';
import { overLimit } from '../src/engine/budget';
import { opSessionId } from '../src/engine/actions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * 2026-10-29 audit: an action on a result of session B checks B's limit. The confirmation must grant «Continue once» and
 * «Don't ask again» to B (the session the action checks), not to the active session A.
 */
const run = { usd: 0.5, approximate: false };
beforeEach(() => {
  const st = useStore.getState();
  useStore.setState({
    spentUsd: 0.9, activeSessionId: 'A',
    sessions: { A: { ...createSession(), id: 'A' }, B: { ...createSession(), id: 'B' } },
    assets: { ...st.assets, xb: { id: 'xb', kind: 'image', sessionId: 'B' } as never },
    settings: { ...st.settings, budgetOn: true, budgetUsd: 1, budgetAccepted: null, budgetNoAsk: false },
  });
});

function mount(sessionId: string | undefined, onConfirm: () => unknown) {
  const host = document.createElement('div');
  document.body.append(host);
  act(() => createRoot(host).render(createElement(SpendConfirm, { title: 't', estimate: run, sessionId, onConfirm, onCancel() {} })));
  const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
  return { button, host };
}

describe('the confirmation belongs to the session the action checks', () => {
  it('«Continue once» for a result of B lets B through, not A', () => {
    let inA = true, inB = false;
    const { button } = mount('B', () => { inA = overLimit(run, 'A'); inB = overLimit(run, 'B'); });
    act(() => button('Continue once').click());
    expect(inB).toBe(false);
    expect(inA).toBe(true);
  });
  it('«Don’t ask again» for a result of B is saved on B, not on the active session', () => {
    const { button } = mount('B', () => undefined);
    act(() => button('ask again').click());
    const s = useStore.getState().sessions;
    expect(s.B.noAskOverLimit).toBe(true);
    expect(Boolean(s.A.noAskOverLimit)).toBe(false);
  });
  it('an asset op resolves to the session of its asset', () => {
    expect(opSessionId('xb')).toBe('B');
  });
});
