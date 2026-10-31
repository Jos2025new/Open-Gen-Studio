// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }) }));
import { SessionsPanel } from '../src/components/shell/SessionsPanel';
import { createSession, useStore } from '../src/store/store';
import type { Asset } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
afterAll(() => vi.unstubAllGlobals());

it('shows the latest visual cover, keeps selection and respects hidden thumbnails', () => {
  const state = useStore.getState();
  const id = state.activeSessionId;
  const session = { ...state.sessions[id], title: 'Test session', hidden: false };
  const asset = (assetId: string, kind: Asset['kind'], createdAt: number) => ({ id: assetId, kind, createdAt, sessionId: id } as Asset);
  useStore.setState({ sessions: { [id]: session }, assets: { old: asset('old', 'image', 1), latest: asset('latest', 'video', 2), audio: asset('audio', 'audio', 3) }, generations: {}, ui: { ...state.ui, panelExpanded: true } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(SessionsPanel)));
  expect(host.querySelector('.sess-cover [data-asset]')?.getAttribute('data-asset')).toBe('latest');
  expect(host.querySelector('.sess-card [aria-label="Session actions"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Hide thumbnails"]')).toBeNull(); // the eye now shows hidden items; covers always show
  expect(host.querySelector('.session-cover-icon')).toBeNull();
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Select Test session"]')!.click());
  expect(host.querySelector('.session-bar')?.textContent).toContain('1 selected');
  act(() => root.unmount()); host.remove();
});

it('selects a date group, archives and restores it, and switches layouts', () => {
  const state = useStore.getState();
  const first = createSession('First');
  const second = createSession('Second');
  first.feed.push({ id: 'prompt', type: 'user', text: 'Create an image', mode: 'image', workspace: 'chat', createdAt: Date.now(), attachments: [] });
  useStore.setState({ sessions: { [first.id]: first, [second.id]: second }, activeSessionId: first.id, assets: {}, generations: {}, ui: { ...state.ui, panelExpanded: true } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(SessionsPanel)));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Images"]')!.click());
  expect(host.querySelectorAll('.sess-card')).toHaveLength(1);
  expect(host.querySelector('.sess-card .pc-info')?.textContent).toContain('First');
  expect(host.querySelector('.sess-card .pc-info')?.textContent).toContain('Image');
  expect(host.querySelector('.sess-card time')?.getAttribute('datetime')).toBe(new Date(first.updatedAt).toISOString());
  act(() => [...host.querySelectorAll<HTMLButtonElement>('.pc-center button')].find((button) => button.textContent === 'All')!.click());
  expect(host.querySelectorAll('.sess-card')).toHaveLength(2);
  const group = host.querySelector<HTMLButtonElement>('.pc-group-check')!;
  act(() => group.click());
  expect(host.querySelector('.session-bar')?.textContent).toContain('2 selected');
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Archive selected"]')!.click());
  expect(useStore.getState().sessions[first.id].archived).toBe(true);
  expect(useStore.getState().sessions[second.id].archived).toBe(true);
  act(() => host.querySelector<HTMLButtonElement>('.pc-strip-end [aria-label^="Show archived"]')!.click());
  expect(host.querySelectorAll('.sess-card')).toHaveLength(2);
  act(() => host.querySelector<HTMLButtonElement>('.sess-card [aria-label="Session actions"]')!.click());
  act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Restore session')!.click());
  expect(Object.values(useStore.getState().sessions).filter((session) => session.archived)).toHaveLength(1);
  act(() => useStore.setState({ ui: { ...useStore.getState().ui, panelExpanded: false } }));
  expect(host.querySelector('.session-cover-icon')).not.toBeNull();
  act(() => host.querySelector<HTMLButtonElement>('.pc-bar [aria-label="View"]')!.click());
  const radio = (t: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === t)!;
  expect(radio('Grid').getAttribute('aria-checked')).toBe('true');
  act(() => radio('List').click());
  expect(host.querySelector('.sessions.layout-list')).not.toBeNull();
  expect(host.querySelector('.sess-row')).not.toBeNull();
  expect(host.querySelector('input[aria-label="Grid size"]')).toBeNull();
  expect(localStorage.getItem('ogs.sessionsView')).toBe('"list"');
  act(() => radio('Grid').click());
  expect(host.querySelector('.sessions.layout-card')).not.toBeNull();
  act(() => root.unmount()); host.remove();
});

it('restores and opens an archived session when its row is pressed', () => {
  const state = useStore.getState();
  const first = createSession('First');
  const second = createSession('Second');
  second.archived = true;
  useStore.setState({ sessions: { [first.id]: first, [second.id]: second }, activeSessionId: first.id, assets: {}, generations: {}, ui: { ...state.ui, panelExpanded: true } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(SessionsPanel)));
  act(() => host.querySelector<HTMLButtonElement>('.pc-strip-end [aria-label^="Show archived"]')!.click());
  expect(host.querySelectorAll('.sess-card')).toHaveLength(1);
  act(() => host.querySelector<HTMLElement>('.session-main')!.click());
  expect(useStore.getState().sessions[second.id].archived).toBeUndefined();
  expect(useStore.getState().activeSessionId).toBe(second.id);
  act(() => root.unmount()); host.remove();
});
