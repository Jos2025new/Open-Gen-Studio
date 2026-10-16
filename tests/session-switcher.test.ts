// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
const deleteSession = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/actions', async (orig) => ({ ...(await orig<typeof import('../src/engine/actions')>()), deleteSession }));

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionSwitcher } from '../src/components/shell/SessionSwitcher';
import { newSession, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const byLabel = (label: string) => q(`[aria-label="${label}"]`)!;

describe('the top bar session switcher', () => {
  it('has search · select several · new session on top; ticked sessions are deleted from the foot after a confirmation', () => {
    newSession(); newSession(); newSession();
    const ids = Object.keys(useStore.getState().sessions);
    const active = useStore.getState().activeSessionId;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(SessionSwitcher, { activeId: active, title: 'T', onRename: () => undefined })));
    act(() => byLabel('Switch session').click());

    const head = q('.switch-head')!;
    expect([...head.children].map((c) => c.getAttribute('aria-label') ?? c.className)).toEqual(['ml-search', 'Select several', 'New session']);
    expect(q('.ml-foot [aria-label^="Delete"]')).toBeNull();

    act(() => byLabel('Select several').click());
    const rows = [...document.querySelectorAll<HTMLElement>('.switch-row')];
    act(() => { rows[0].click(); rows[1].click(); });
    expect(useStore.getState().activeSessionId).toBe(active); // ticking does not switch
    act(() => byLabel('Delete 2 selected').click());
    expect(deleteSession).not.toHaveBeenCalled(); // asks first
    const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete 2')!;
    act(() => confirm.click());
    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(ids).toEqual(expect.arrayContaining(deleteSession.mock.calls.map((c) => c[0])));
    expect(q('.ml-foot [aria-label^="Delete"]')).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});
