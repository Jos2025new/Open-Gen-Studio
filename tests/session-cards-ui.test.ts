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
  expect(host.querySelector('.session-cover [data-asset]')?.getAttribute('data-asset')).toBe('latest');
  expect(host.querySelector('.session-row [aria-label="Rename"]')).not.toBeNull();
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Hide thumbnails"]')!.click());
  expect(host.querySelector('.session-cover [data-asset]')).toBeNull();
  expect(host.querySelector('.session-cover-icon')).not.toBeNull();
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
  expect(host.querySelectorAll('.session-row')).toHaveLength(1);
  expect(host.querySelector('.session-row')?.textContent).toContain('First');
  expect(host.querySelector('.session-list-mode')?.textContent).toBe('Image');
  expect(host.querySelector('.session-list-created')?.getAttribute('datetime')).toBe(new Date(first.createdAt).toISOString());
  expect(host.querySelector('.session-list-updated')?.getAttribute('datetime')).toBe(new Date(first.updatedAt).toISOString());
  act(() => [...host.querySelectorAll<HTMLButtonElement>('.sessions-quick-modes button')].find((button) => button.textContent === 'All')!.click());
  expect(host.querySelectorAll('.session-row')).toHaveLength(2);
  const group = host.querySelector<HTMLButtonElement>('.group-check')!;
  act(() => group.click());
  expect(host.querySelector('.session-bar')?.textContent).toContain('2 selected');
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Archive selected"]')!.click());
  expect(useStore.getState().sessions[first.id].archived).toBe(true);
  expect(useStore.getState().sessions[second.id].archived).toBe(true);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Filter by"]')!.click());
  const archived = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Archived'))!;
  act(() => archived.click());
  expect(host.querySelectorAll('.session-row')).toHaveLength(2);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Restore session"]')!.click());
  expect(Object.values(useStore.getState().sessions).filter((session) => session.archived)).toHaveLength(1);
  act(() => useStore.setState({ ui: { ...useStore.getState().ui, panelExpanded: false } }));
  expect(host.querySelector('.session-cover-icon')).not.toBeNull();
  const view = host.querySelector<HTMLButtonElement>('[aria-label="View"]')!;
  expect(view.textContent).toContain('Cards');
  act(() => view.click());
  const grid = [...document.querySelectorAll<HTMLButtonElement>('.session-view-option')].find((button) => button.textContent?.includes('Grid'))!;
  act(() => grid.click());
  expect(host.querySelector('.sessions.layout-grid')).not.toBeNull();
  expect(view.textContent).toContain('Grid');
  expect(view.getAttribute('aria-expanded')).toBe('false');
  act(() => root.unmount()); host.remove();
});
