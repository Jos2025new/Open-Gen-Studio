// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
const generateDirect = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/engine/actions', async (orig) => ({
  ...(await orig<typeof import('../src/engine/actions')>()),
  generateDirect,
  checkDirect: () => ({ ok: true, estimate: { usd: 0.04 }, overLimit: false }),
}));
vi.mock('../src/engine/catalog', async (orig) => ({ ...(await orig<typeof import('../src/engine/catalog')>()), ensureSchema: async () => undefined }));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OPS } from '../src/engine/ops';
import { HomeView } from '../src/components/shell/HomeView';
import { CREATE, openCreate, openHome, openLibrary, openSpace, SPACES } from '../src/components/shell/navModel';
import { installHomeAutoClose, installHomeKeyGuard } from '../src/components/shell/homeGuard';
import { SpacePanel } from '../src/components/space/SpacePanel';
import { splitBoard, suggestedOps, targetAsset, type BoardOptions } from '../src/components/space/boardModel';
import { newSession, setUi, useStore } from '../src/store/store';
import type { Asset, Generation } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installHomeKeyGuard();
installHomeAutoClose();
const ui = () => useStore.getState().ui;

describe('navigation into the Create space', () => {
  it('each Create tile opens the space with its mode, over the chat workspace, and leaves Home', () => {
    for (const c of CREATE) {
      setUi({ workspace: 'node' });
      openHome();
      openCreate(c);
      expect(useStore.getState().composer.mode).toBe(c.mode);
      expect(ui()).toMatchObject({ workspace: 'chat', home: false, space: 'create' });
    }
  });
  it('Home and the Spaces entries close it', () => {
    openCreate(CREATE[0]);
    openHome();
    expect(ui()).toMatchObject({ home: true, space: undefined });
    openCreate(CREATE[0]);
    openSpace(SPACES[1]);
    expect(ui()).toMatchObject({ workspace: 'node', space: undefined });
  });
  it('a later session or composer-focus change closes it; opening it does not', () => {
    setUi({ workspace: 'node' });
    openCreate(CREATE[1]);
    expect(ui().space).toBe('create');
    newSession();
    expect(ui().space).toBeUndefined();
    openCreate(CREATE[1]);
    setUi((u) => ({ focusComposer: u.focusComposer + 1 }));
    expect(ui().space).toBeUndefined();
  });
});

describe('Library from the space', () => {
  it('leaves the space and opens Home on its Library tab; Home from the sidebar starts on Home', () => {
    openCreate(CREATE[0]);
    openLibrary();
    expect(ui()).toMatchObject({ home: true, space: undefined, homeTab: 'gallery', panel: null });
    openHome();
    expect(ui().homeTab).toBe('home');
    setUi({ home: false });
  });
  it('Home draws the tab from the UI state', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    openLibrary();
    act(() => root.render(createElement(HomeView)));
    expect(host.querySelector('.home-tab.is-active')?.textContent).toBe('Library');
    act(() => (host.querySelectorAll('.home-tab')[2] as HTMLButtonElement).click());
    expect(ui().homeTab).toBe('sessions');
    act(() => root.unmount());
    host.remove();
    setUi({ home: false });
  });
});

describe('key guard while the space shows', () => {
  const press = (target: EventTarget) => {
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    window.removeEventListener('keydown', seen);
    return seen.mock.calls.length;
  };
  it('stops workspace shortcuts, lets keys typed inside the space reach the space but not the window', () => {
    const space = document.createElement('div');
    space.className = 'space';
    const input = document.createElement('textarea');
    const own = vi.fn();
    input.addEventListener('keydown', own);
    space.append(input);
    document.body.append(space);
    setUi({ space: 'create' });
    expect(press(document.body)).toBe(0);
    expect(press(input)).toBe(0);
    expect(own).toHaveBeenCalledTimes(1);
    setUi({ space: undefined });
    expect(press(document.body)).toBe(1);
    space.remove();
  });
});

describe('Generate in the panel', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    generateDirect.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    useStore.setState((s) => ({ composer: { ...s.composer, mode: 'video' } }));
    act(() => root.render(createElement(SpacePanel)));
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('shows the four modes and the selected one', () => {
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Image', 'Video', 'Audio', '3D']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });
  it('the button runs the composer path (generateDirect) for the selected mode', () => {
    act(() => host.querySelector<HTMLButtonElement>('.send-btn.is-generate')!.click());
    expect(generateDirect).toHaveBeenCalledWith('video');
  });
  it('Enter in the prompt does the same; changing tab changes the mode', () => {
    const ta = host.querySelector('textarea')!;
    act(() => ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(generateDirect).toHaveBeenCalledTimes(1);
    act(() => (host.querySelectorAll('[role="tab"]')[0] as HTMLButtonElement).click());
    expect(useStore.getState().composer.mode).toBe('image');
    act(() => host.querySelector<HTMLButtonElement>('.send-btn.is-generate')!.click());
    expect(generateDirect).toHaveBeenLastCalledWith('image');
  });
});

const gen = (id: string, status: Generation['status'], assetIds: string[] = [], extra: Partial<Generation> = {}) =>
  ({ id, sessionId: 's1', kind: 'image', prompt: id, modelName: 'm', provider: 'demo', status, assetIds, estimate: { usd: 0 }, createdAt: Number(id.slice(1)), ...extra }) as unknown as Generation;
const asset = (id: string, favorite = false, kind: Asset['kind'] = 'image') => ({ id, kind, favorite }) as unknown as Asset;
const opts: BoardOptions = { kind: 'all', status: 'all', q: '', sort: 'newest', starred: false, showFailed: false, scope: 'all' };

describe('board rows', () => {
  const generations = Object.fromEntries([gen('g1', 'done', ['a1', 'a2']), gen('g2', 'running'), gen('g3', 'queued'), gen('g4', 'error', [], { error: 'x' }), gen('g5', 'done', ['a3'], { sessionId: 's2' })].map((g) => [g.id, g]));
  const assets = { a1: asset('a1', true), a2: asset('a2'), a3: asset('a3') };
  it('splits finished assets from running and queued generations', () => {
    const r = splitBoard(generations, assets, opts);
    expect(r.done.map((c) => (c.type === 'asset' ? c.assetId : 'f'))).toEqual(['a3', 'a1', 'a2']);
    expect(r.ongoing.map((g) => g.id).sort()).toEqual(['g2', 'g3']);
  });
  it('failed generations only appear with show failed', () => {
    expect(splitBoard(generations, assets, opts).failed).toEqual([]);
    const on = splitBoard(generations, assets, { ...opts, showFailed: true });
    expect(on.failed.map((g) => g.id)).toEqual(['g4']);
    expect(on.done.every((c) => c.type === 'asset')).toBe(true);
    expect(on.done).toHaveLength(3);
  });
  it('favorites only keeps starred assets in Done; the Failed row is independent', () => {
    const r = splitBoard(generations, assets, { ...opts, starred: true, showFailed: true });
    expect(r.failed).toHaveLength(1);
    expect(r.done).toEqual([{ type: 'asset', assetId: 'a1', generationId: 'g1' }]);
  });
  it('this session limits the board', () => {
    expect(splitBoard(generations, assets, { ...opts, scope: { sessionId: 's2' } }).done).toHaveLength(1);
  });
  it('suggested actions follow the target asset: the selected one, else the newest', () => {
    const r = splitBoard(generations, assets, opts);
    expect(targetAsset(r, [], assets, 'image')).toBe('a3');
    expect(targetAsset(r, ['a2', 'zz'], assets, 'image')).toBe('a2');
    expect(suggestedOps(assets.a1).length).toBeGreaterThan(0);
    expect(suggestedOps(undefined)).toEqual([]);
  });
  it('actions follow the mode: image ops only for images, none without an asset of that kind', () => {
    const withVideo = { ...assets, v1: asset('v1', false, 'video') };
    const gens = { ...generations, g6: gen('g6', 'done', ['v1'], { kind: 'video', createdAt: 9 }) };
    const r = splitBoard(gens, withVideo, opts);
    expect(targetAsset(r, [], withVideo, 'video')).toBe('v1');
    expect(targetAsset(r, [], withVideo, 'image')).toBe('a3');
    expect(targetAsset(r, ['v1'], withVideo, 'image')).toBe('a3');
    expect(targetAsset(r, [], withVideo, 'audio')).toBeUndefined();
    const imageOps = suggestedOps(withVideo.a1);
    const videoOps = suggestedOps(withVideo.v1);
    expect(imageOps.every((id) => OPS[id].input === 'image')).toBe(true);
    expect(videoOps.some((id) => imageOps.includes(id) && OPS[id].input !== 'video')).toBe(false);
  });
});
