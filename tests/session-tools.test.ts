// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, deleteAssetBlobs: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }) }));
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SessionInfo, SessionMenu } from '../src/components/shell/SessionTools';
import { SessionSwitcher } from '../src/components/shell/SessionSwitcher';
import { TopbarActions } from '../src/components/shell/TopBar';
import { createSession, useStore } from '../src/store/store';
import type { Asset, Generation } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });

let host: HTMLDivElement;
let root: Root;
let sid = '';
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const byLabel = (l: string) => document.querySelector<HTMLElement>(`[aria-label="${l}"]`);
const items = () => [...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent);
const gen = (id: string, status: Generation['status'], createdAt: number) => ({ id, sessionId: sid, kind: 'image', prompt: `Prompt ${id}`, modelName: 'M', provider: 'demo', status, assetIds: [], settings: { count: 1, advanced: {}, aspect: '1:1', resolution: '1k' }, estimate: { usd: 0 }, createdAt }) as unknown as Generation;

beforeEach(() => {
  const s = createSession('Night market');
  sid = s.id;
  const asset = { id: 'a1', kind: 'image', origin: 'generated', createdAt: 5, favorite: false, width: 10, height: 10, stored: true, sessionId: sid, generationId: 'g1' } as unknown as Asset;
  useStore.setState((st) => ({ settings: { ...st.settings, budgetOn: false } }));
  useStore.setState({ sessions: { [sid]: s }, activeSessionId: sid, generations: { g1: gen('g1', 'done', 1), g2: gen('g2', 'running', 2) }, assets: { a1: asset }, spendLog: [{ at: 1, usd: 0.4, estimated: false, category: 'image', provider: 'demo', model: 'M', sessionId: sid }, { at: 1, usd: 9, estimated: false, category: 'image', provider: 'demo', model: 'M', sessionId: 'other' }] as never });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

it('session info shows this session only: usage, what is running with its status, latest results, and View all opens Generations', () => {
  const onGenerations = vi.fn();
  act(() => root.render(createElement(SessionInfo, { onGenerations })));
  click(byLabel('Session info'));
  const pop = document.querySelector('.si')!;
  expect(pop.querySelector('.si-title')?.textContent).toBe('Night market');
  expect([...pop.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'))).toEqual(['Usage', 'Running', 'Results']);
  expect([...pop.querySelectorAll('.si-tile')].map((t) => t.textContent)).toEqual(['Spent$0.4', 'Agent$0', 'Media$0.4']);
  expect([...pop.querySelectorAll('.si-bars li')].map((l) => l.textContent)).toEqual(['Images ×1$0.4']);
  expect(pop.querySelector('.si-budget')).toBeNull();
  expect(pop.querySelector('.si-gen [aria-label="Running"]')?.closest('.si-row')?.textContent).toContain('Prompt g2');
  expect(pop.querySelectorAll('.si-file')).toHaveLength(1);
  expect(pop.querySelector('.si-gen small')?.textContent).toMatch(/^M · 1:1 · /);
  expect(pop.querySelector('.si-file small')?.textContent).toBe('Image · 10×10 · M');
  click([...pop.querySelectorAll('button')].find((b) => b.textContent === 'View all'));
  expect(onGenerations).toHaveBeenCalled();
});

it('with a spending limit on, session info shows the budget counter, and Spending details opens the Spending panel', () => {
  useStore.setState((st) => ({ spentUsd: 1.27, settings: { ...st.settings, budgetOn: true, budgetUsd: 25 } }));
  act(() => root.render(createElement(SessionInfo, { onGenerations: () => undefined })));
  click(byLabel('Session info'));
  expect(document.querySelector('.si-budget')?.textContent).toContain('$1.27 of $25 · $23.73 left');
  click([...document.querySelectorAll('.si-more')].find((b) => b.textContent === 'Spending details'));
  expect(useStore.getState().ui.panel).toBe('spending');
});

it('the ⋯ menu groups the session actions with Delete last, behind a confirmation', () => {
  const onRename = vi.fn();
  act(() => root.render(createElement(SessionMenu, { onRename })));
  click(byLabel('Session actions'));
  expect(items()).toEqual(['Rename', 'Pin', 'Archive session', 'Hide', 'Delete']);
  expect(document.querySelectorAll('.pc-menu-sep')).toHaveLength(2);
  click([...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent === 'Pin'));
  expect(useStore.getState().sessions[sid].pinned).toBe(true);
  click(byLabel('Session actions'));
  click([...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent === 'Delete'));
  expect(document.querySelector('.confirm')?.textContent).toContain('Delete “Night market”');
  expect(useStore.getState().sessions[sid]).toBeDefined();
});

it('the workspace import button sits in the switcher, beside its short search', () => {
  act(() => root.render(createElement(Fragment, null,
    createElement(SessionSwitcher, { activeId: sid, title: 'Night market', onRename: () => undefined }),
    createElement(TopbarActions, { side: 'left', children: createElement('button', { 'aria-label': 'Import from Chat', className: 'import-chat-btn' }) }))));
  expect(byLabel('Import from Chat')).toBeNull();
  click(byLabel('Switch session'));
  expect(document.querySelector('.switch-head .switch-actions [aria-label="Import from Chat"]')).not.toBeNull();
});
