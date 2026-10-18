// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
const sendAgentMessage = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/engine/agent/runtime', async (orig) => ({ ...(await orig<typeof import('../src/engine/agent/runtime')>()), sendAgentMessage }));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HomeBar } from '../src/components/shell/HomeBar';
import { HomeView } from '../src/components/shell/HomeView';
import { newSession, setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const type = (input: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('HomeBar draft', () => {
  it('survives unmount (tab switch) and remounts with the text', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    let root = createRoot(host);
    await act(async () => root.render(createElement(HomeBar)));
    await act(async () => type(host.querySelector('input.home-bar-input')!, 'a red fox'));
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(createElement(HomeBar)));
    expect((host.querySelector('input.home-bar-input') as HTMLInputElement).value).toBe('a red fox');
    await act(async () => root.unmount());
  });
});

describe('Home draft through the real HomeView tabs', () => {
  let root: Root | undefined;
  let host: HTMLElement;
  const input = () => host.querySelector('input.home-bar-input') as HTMLInputElement | null;
  const tab = (label: string) => [...host.querySelectorAll('button.home-tab')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  const draftOf = () => useStore.getState().ui.homeDrafts?.[useStore.getState().activeSessionId];
  const goButton = () => host.querySelector('button.home-bar-go') as HTMLButtonElement;
  const mount = () => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root!.render(createElement(HomeView))); };
  const setBusy = (busy: boolean) => useStore.setState((s) => ({ sessions: { ...s.sessions, [s.activeSessionId]: { ...s.sessions[s.activeSessionId], agent: { ...s.sessions[s.activeSessionId].agent, busy } } } }));

  beforeEach(() => {
    setBusy(false);
    sendAgentMessage.mockClear();
    setUi({ home: true, space: undefined, homeTab: 'home', homeDrafts: {} });
    if (!useStore.getState().sessions[useStore.getState().activeSessionId]) newSession();
    useStore.setState((s) => ({ composer: { ...s.composer, attachments: [] } }));
  });
  afterEach(() => { act(() => root?.unmount()); root = undefined; host?.remove(); });

  it('keeps the typed draft across Sessions and Library and back to Home', () => {
    mount();
    act(() => type(input()!, 'a red fox'));
    act(() => tab('Sessions').click());
    expect(input()).toBeNull();
    expect(draftOf()).toBe('a red fox');
    act(() => tab('Library').click());
    expect(input()).toBeNull();
    act(() => tab('Home').click());
    expect(input()!.value).toBe('a red fox');
  });

  it('clears the draft once a send goes ahead, and leaves Home for Studio', () => {
    mount();
    act(() => type(input()!, 'a red fox'));
    act(() => goButton().click());
    expect(sendAgentMessage).toHaveBeenCalledWith('a red fox');
    expect(draftOf()).toBe('');
    expect(useStore.getState().ui.home).toBe(false);
  });

  it('keeps the draft and sends nothing while the agent is busy', () => {
    mount();
    setBusy(true);
    act(() => type(input()!, 'a red fox'));
    expect(goButton().disabled).toBe(true);
    act(() => goButton().click());
    act(() => { host.querySelector('form.home-bar-wrap')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(draftOf()).toBe('a red fox');
    expect(useStore.getState().ui.home).toBe(true);
  });
});

describe('Home draft persistence and sessions', () => {
  let root: Root | undefined;
  let host: HTMLElement;
  const input = () => host.querySelector('input.home-bar-input') as HTMLInputElement | null;
  const mount = () => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root!.render(createElement(HomeBar))); };
  const draftOf = () => useStore.getState().ui.homeDrafts?.[useStore.getState().activeSessionId];
  afterEach(() => { act(() => root?.unmount()); root = undefined; host?.remove(); });

  it('the draft survives a store rehydrate (partialize then merge)', () => {
    const id = useStore.getState().activeSessionId;
    setUi({ homeDrafts: { [id]: 'a red fox' } });
    const opts = useStore.persist.getOptions();
    const stored = JSON.parse(JSON.stringify(opts.partialize!(useStore.getState())));
    const restored = opts.merge!(stored, useStore.getState()) as ReturnType<typeof useStore.getState>;
    expect(restored.ui.homeDrafts?.[id]).toBe('a red fox');
  });

  it('a draft typed in session A is not shown in session B and returns when switching back to A', () => {
    const a = useStore.getState().activeSessionId;
    mount();
    act(() => type(input()!, 'a red fox'));
    const b = newSession();
    act(() => root!.render(createElement(HomeBar)));
    expect(useStore.getState().activeSessionId).toBe(b);
    expect(input()!.value).toBe('');
    act(() => type(input()!, 'a blue whale'));
    useStore.setState({ activeSessionId: a });
    act(() => root!.render(createElement(HomeBar)));
    expect(input()!.value).toBe('a red fox');
  });

  it('keeps the draft when the send is refused because the session turned busy after the render', () => {
    sendAgentMessage.mockClear();
    mount();
    act(() => type(input()!, 'a red fox'));
    // Busy flips without a re-render: the submit below runs with the last render's guard.
    useStore.setState((s) => ({ sessions: { ...s.sessions, [s.activeSessionId]: { ...s.sessions[s.activeSessionId], agent: { ...s.sessions[s.activeSessionId].agent, busy: true } } } }));
    host.querySelector('form.home-bar-wrap')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(draftOf()).toBe('a red fox');
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });
});
