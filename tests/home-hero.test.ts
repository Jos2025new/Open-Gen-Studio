// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { HomeHero } from '../src/components/shell/HomeHero';
import { installHomeAutoClose } from '../src/components/shell/homeGuard';
import { sessionDocs } from '../src/engine/design/actions';
import { setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
installHomeAutoClose();

const ui = () => useStore.getState().ui;
const sessionCount = () => Object.keys(useStore.getState().sessions).length;
let root: Root | undefined;
let host: HTMLElement;

function setReducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches, addEventListener() {}, removeEventListener() {} }) });
}
function mount(): void {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(HomeHero)));
}
const onSlide = (): number => [...host.querySelectorAll('.home-hero-slide')].findIndex((el) => el.classList.contains('is-on'));
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const hero = () => host.querySelector('.home-hero') as HTMLElement;
const byText = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
function typeInto(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}

function setBusy(busy: boolean): void {
  useStore.setState((s) => ({ sessions: { ...s.sessions, [s.activeSessionId]: { ...s.sessions[s.activeSessionId], agent: { ...s.sessions[s.activeSessionId].agent, busy } } } }));
}
beforeEach(() => { vi.useFakeTimers(); setReducedMotion(false); setBusy(false); useStore.setState((s) => ({ composer: { ...s.composer, attachments: [] } })); setUi({ home: true, space: undefined, homeDraft: '' }); sendAgentMessage.mockClear(); });
afterEach(() => { act(() => root?.unmount()); root = undefined; host?.remove(); vi.useRealTimers(); });

describe('hero carousel', () => {
  it('advances every 7 seconds and wraps', () => {
    mount();
    expect(onSlide()).toBe(0);
    advance(6900);
    expect(onSlide()).toBe(0);
    advance(100);
    expect(onSlide()).toBe(1);
    advance(7000);
    expect(onSlide()).toBe(2);
    advance(7000);
    expect(onSlide()).toBe(0);
  });
  it('pauses while hovered and resumes on leave', () => {
    mount();
    act(() => { hero().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    advance(14000);
    expect(onSlide()).toBe(0);
    act(() => { hero().dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
    advance(7000);
    expect(onSlide()).toBe(1);
  });
  it('pauses while a control in it has focus', () => {
    mount();
    act(() => (host.querySelector('.home-hero-dot') as HTMLElement).focus());
    advance(14000);
    expect(onSlide()).toBe(0);
  });
  it('does not autoplay under reduced motion, but the dots still switch slides', () => {
    setReducedMotion(true);
    mount();
    advance(21000);
    expect(onSlide()).toBe(0);
    act(() => (host.querySelectorAll('.home-hero-dot')[1] as HTMLButtonElement).click());
    expect(onSlide()).toBe(1);
  });
  it('clicking a dot shows that slide', () => {
    mount();
    act(() => (host.querySelectorAll('.home-hero-dot')[2] as HTMLButtonElement).click());
    expect(onSlide()).toBe(2);
    expect(host.querySelectorAll('.home-hero-dot')[2].getAttribute('aria-selected')).toBe('true');
  });
});

describe('new canvas and new design', () => {
  it('"+ New canvas" creates one session and closes Home in the same tick', () => {
    mount();
    act(() => (host.querySelectorAll('.home-hero-dot')[1] as HTMLButtonElement).click());
    const before = sessionCount();
    act(() => byText('+ New canvas').click());
    expect(sessionCount()).toBe(before + 1);
    expect(ui()).toMatchObject({ home: false, workspace: 'node' });
  });
  it('"+ New design" creates one session with one document and opens Designer', () => {
    mount();
    act(() => (host.querySelectorAll('.home-hero-dot')[2] as HTMLButtonElement).click());
    const before = sessionCount();
    act(() => byText('+ New design').click());
    expect(sessionCount()).toBe(before + 1);
    expect(sessionDocs(useStore.getState().activeSessionId)).toHaveLength(1);
    expect(ui()).toMatchObject({ home: false, workspace: 'designer' });
  });
});

describe('Home prompt bar', () => {
  it('submit opens Studio and sends the text to the agent', () => {
    mount();
    const input = host.querySelector('.home-bar-input') as HTMLInputElement;
    typeInto(input, '  a poster for a bakery  ');
    act(() => (host.querySelector('.home-bar-go') as HTMLButtonElement).click());
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledWith('a poster for a bakery');
    expect(useStore.getState().composer.mode).toBe('agent');
    expect(ui()).toMatchObject({ home: false, workspace: 'chat' });
  });
  it('is blocked while the agent is busy', () => {
    mount();
    setBusy(true);
    typeInto(host.querySelector('.home-bar-input') as HTMLInputElement, 'hello');
    const go = host.querySelector('.home-bar-go') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    act(() => go.click());
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(ui().home).toBe(true);
    expect((host.querySelector('.home-bar-input') as HTMLInputElement).value).toBe('hello');
  });
  it('attachments alone can send, and the attachment goes with the message', () => {
    mount();
    act(() => useStore.setState((s) => ({ assets: { ...s.assets, a1: { id: 'a1', kind: 'image', name: 'ref.png' } as never }, composer: { ...s.composer, attachments: ['a1'] } })));
    expect(host.querySelector('.home-bar-files')?.textContent).toContain('ref.png');
    const go = host.querySelector('.home-bar-go') as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    act(() => go.click());
    expect(sendAgentMessage).toHaveBeenCalledWith('');
  });
  it('an empty bar does not send', () => {
    mount();
    expect((host.querySelector('.home-bar-go') as HTMLButtonElement).disabled).toBe(true);
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });
});
