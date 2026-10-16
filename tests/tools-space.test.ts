// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  putAssetBlob: async () => undefined,
}));
const runAssetOp = vi.hoisted(() => vi.fn(async () => [] as string[]));
vi.mock('../src/engine/actions', async (orig) => ({
  ...(await orig<typeof import('../src/engine/actions')>()),
  runAssetOp,
  opEstimate: async () => ({ estimate: { usd: 0.1 }, modelName: 'Test model', modelRef: 'x' }),
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ALL_TOOLS, openCreate, openHome, openTool, CREATE, SPACES, openSpace } from '../src/components/shell/navModel';
import { installHomeAutoClose, installHomeKeyGuard } from '../src/components/shell/homeGuard';
import { ToolsPanel } from '../src/components/space/ToolsPanel';
import { OPS, defaultOpParams } from '../src/engine/ops';
import { newSession, setUi, useStore } from '../src/store/store';
import type { Asset } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installHomeKeyGuard();
installHomeAutoClose();
const ui = () => useStore.getState().ui;
const tool = (id: string) => ALL_TOOLS.find((t) => t.id === id)!;

describe('navigation into the Tools space', () => {
  it('every tool opens the space with itself selected, over the chat workspace', () => {
    for (const t of ALL_TOOLS) {
      setUi({ workspace: 'node' });
      openHome();
      openTool(t);
      expect(ui()).toMatchObject({ workspace: 'chat', home: false, space: 'tools', toolOp: t.id });
    }
  });
  it('Create, Spaces and Home replace it; a later session change closes it', () => {
    openTool(tool('upscale'));
    openCreate(CREATE[0]);
    expect(ui().space).toBe('create');
    openTool(tool('upscale'));
    openSpace(SPACES[1]);
    expect(ui().space).toBeUndefined();
    openTool(tool('upscale'));
    openHome();
    expect(ui().space).toBeUndefined();
    setUi({ workspace: 'node' });
    openTool(tool('upscale'));
    newSession();
    expect(ui().space).toBeUndefined();
  });
  it('the key guard covers it', () => {
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    setUi({ space: 'tools' });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    window.removeEventListener('keydown', seen);
    setUi({ space: undefined });
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('Generate in the Tools panel', () => {
  let host: HTMLDivElement;
  let root: Root;
  const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 250)); });
  const generate = () => host.querySelector<HTMLButtonElement>('.send-btn.is-generate')!;
  beforeEach(() => {
    runAssetOp.mockClear();
    useStore.setState((s) => ({ assets: { ...s.assets, a1: { id: 'a1', kind: 'image', origin: 'generated', createdAt: 1, favorite: false } as unknown as Asset } }));
    setUi({ space: 'tools', toolOp: 'relight' });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(createElement(ToolsPanel)));
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); setUi({ space: undefined }); });

  it('shows the kind tabs, the chosen tool and the empty input slot', () => {
    expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Image', 'Video', 'Audio']);
    expect(host.querySelector('.space-tool-name')?.textContent).toBe(OPS.relight.label);
    expect(host.querySelector('.space-slot-empty')).not.toBeNull();
  });
  it('without an input asset Generate is blocked and runs nothing', () => {
    expect(generate().getAttribute('aria-disabled')).toBe('true');
    act(() => generate().click());
    expect(runAssetOp).not.toHaveBeenCalled();
  });
  it('with an asset it runs the existing op path with that asset and the op fields', async () => {
    const slot = host.querySelector('.space-slot')!;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'a1', types: ['application/x-ogs-asset'], files: [] } });
    act(() => { slot.dispatchEvent(drop); });
    await wait();
    expect(generate().getAttribute('aria-disabled')).toBe('false');
    act(() => generate().click());
    expect(runAssetOp).toHaveBeenCalledWith('a1', 'relight', defaultOpParams(OPS.relight), undefined, undefined);
  });
  it('a video asset is refused by an image tool', () => {
    useStore.setState((s) => ({ assets: { ...s.assets, v1: { id: 'v1', kind: 'video', origin: 'generated', createdAt: 2, favorite: false } as unknown as Asset } }));
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'v1', types: ['application/x-ogs-asset'], files: [] } });
    act(() => { host.querySelector('.space-slot')!.dispatchEvent(drop); });
    expect(host.querySelector('.space-slot-empty')).not.toBeNull();
  });
  it('an input asset of another kind than the tool takes (left over from another tab) is dropped', () => {
    useStore.setState((s) => ({ assets: { ...s.assets, v2: { id: 'v2', kind: 'video', origin: 'generated', createdAt: 3, favorite: false } as unknown as Asset } }));
    act(() => setUi({ toolAsset: 'v2' }));
    expect(host.querySelector('.space-slot-empty')).not.toBeNull();
    expect(generate().getAttribute('aria-disabled')).toBe('true');
  });
  it('while the cost is being calculated Generate runs nothing; it runs once the estimate is in, and again waits after a change', async () => {
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'a1', types: ['application/x-ogs-asset'], files: [] } });
    act(() => { host.querySelector('.space-slot')!.dispatchEvent(drop); });
    expect(generate().getAttribute('aria-disabled')).toBe('true');
    act(() => generate().click());
    expect(runAssetOp).not.toHaveBeenCalled();
    await wait();
    expect(generate().getAttribute('aria-disabled')).toBe('false');
    const choice = host.querySelector<HTMLButtonElement>('.space-opfields button:not(.is-active)');
    expect(choice).not.toBeNull();
    act(() => choice!.click());
    expect(generate().getAttribute('aria-disabled')).toBe('true');
    act(() => generate().click());
    expect(runAssetOp).not.toHaveBeenCalled();
    await wait();
    expect(generate().getAttribute('aria-disabled')).toBe('false');
  });
});
