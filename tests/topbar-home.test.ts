import { readFileSync } from 'node:fs';
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TopBar } from '../src/components/shell/TopBar';
import { setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
let root: Root | undefined;
const firstSession = useStore.getState().activeSessionId;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''; useStore.setState({ activeSessionId: firstSession }); });

/** Mounts the bar and returns its markup. Zustand reads the live state only on the client, so SSR would show the initial state. */
function mount(home: boolean): HTMLElement {
  setUi({ home });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(TopBar, { slotRef: () => undefined })));
  return host;
}

describe('top bar on Home', () => {
  it('keeps Settings and a Connected pill, and drops the breadcrumb and Generations', () => {
    const host = mount(true);
    expect(host.querySelector('.ws-tag')).toBeNull();
    expect(host.textContent).not.toContain('Generations');
    const pill = host.querySelector('.topbar-pill') as HTMLButtonElement;
    expect(pill.textContent).toBe('Connected');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[aria-label="Settings"]')).not.toBeNull();
  });
  it('the pill opens the Connected popover as before', () => {
    const host = mount(true);
    act(() => (host.querySelector('.topbar-pill') as HTMLButtonElement).click());
    expect(host.querySelector('.topbar-pill')?.getAttribute('aria-expanded')).toBe('true');
  });
  it('outside Home the breadcrumb, Generations and the plain Connected button are unchanged', () => {
    const host = mount(false);
    expect(host.querySelector('.ws-tag')).not.toBeNull();
    expect(host.textContent).toContain('Generations');
    expect(host.querySelector('.topbar-pill')).toBeNull();
    expect(host.querySelector('.topbar-menu')?.textContent).toContain('Connected');
  });
  it('outside Home a Home button sits before the breadcrumb and opens Home', () => {
    const host = mount(false);
    const btn = host.querySelector('.topbar-home') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Home');
    expect(btn.getAttribute('title')).toBe('Home');
    expect(btn.compareDocumentPosition(host.querySelector('.ws-tag')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => btn.click());
    expect(useStore.getState().ui.home).toBe(true);
  });
  it('on Home the Home button is absent', () => {
    const host = mount(true);
    expect(host.querySelector('.topbar-home')).toBeNull();
  });
  it('on Home a back pill names the workspace and the session', () => {
    const id = useStore.getState().activeSessionId;
    setUi({ workspace: 'chat' });
    useStore.setState((st) => ({ sessions: { ...st.sessions, [id]: { ...st.sessions[id], title: 'Logo ideas' } } }));
    const host = mount(true);
    const back = host.querySelector('.topbar-back') as HTMLButtonElement;
    expect(back.textContent).toContain('Logo ideas');
    expect(back.getAttribute('aria-label')).toBe('Back to Chat · Logo ideas');
    expect(back.getAttribute('title')).toBe('Back to Chat · Logo ideas');
  });
  it('clicking the back pill closes Home and keeps the workspace and session', () => {
    const id = useStore.getState().activeSessionId;
    setUi({ workspace: 'designer' });
    const host = mount(true);
    act(() => (host.querySelector('.topbar-back') as HTMLButtonElement).click());
    expect(useStore.getState().ui).toMatchObject({ home: false, workspace: 'designer' });
    expect(useStore.getState().activeSessionId).toBe(id);
  });
  it('the back pill is hidden with no active session', () => {
    useStore.setState({ activeSessionId: 'no-such-session' });
    const host = mount(true);
    expect(host.querySelector('.topbar-back')).toBeNull();
  });
  it('Escape on Home goes back, unless a field has focus', () => {
    const host = mount(true);
    const field = document.createElement('input');
    host.append(field);
    field.focus();
    act(() => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(useStore.getState().ui.home).toBe(true);
    const pill = host.querySelector('.topbar-back') as HTMLButtonElement;
    pill.focus();
    act(() => { pill.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(useStore.getState().ui.home).toBe(false);
  });
  it('the Home background rules exist', () => {
    const topbar = readFileSync('src/styles/topbar-home.css', 'utf8');
    const home = readFileSync('src/styles/home.css', 'utf8');
    expect(topbar).toMatch(/\.topbar\.is-home\s*\{\s*background:\s*var\(--bg-canvas\)/);
    expect(home).toMatch(/\.workspace \.home \{[^}]*background: var\(--bg-canvas\)/);
  });
});

