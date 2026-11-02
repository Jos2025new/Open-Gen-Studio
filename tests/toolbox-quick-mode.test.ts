// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { ToolDock } from '../src/components/designer/ToolDock';
import { createDoc } from '../src/engine/design/doc';
import { pickUi } from '../src/store/persistUi';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialUi = useStore.getState().ui;
let root: Root, host: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  useStore.setState({ ui: { ...initialUi, tool: 'move', selectShape: 'rect', promptHidden: false } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(ToolDock, { sessionId: 'test', doc: { ...createDoc('Dock', 100, 100), paintMode: 'drawing' }, designer: true })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useStore.setState({ ui: initialUi }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const btn = (label: string) => [...host.querySelectorAll('button')].filter((b) => b.getAttribute('aria-label') === label).at(-1)!;
const click = async (label: string) => { expect(btn(label), label).toBeTruthy(); await act(async () => btn(label).click()); };
const quick = () => host.querySelector('[aria-label="Quick settings"]');

describe('quick mode of the bottom toolbox', () => {
  it('choosing Brush shows « , the tool icon, Size and Opacity, the color, Eraser and Settings in that order; the other tools are hidden', async () => {
    await click('Brush');
    expect(quick()).toBeTruthy();
    expect(host.querySelector('[aria-label="Tools"]')).toBeNull();
    const parts = [...quick()!.querySelectorAll('button, .opt-label, [role="slider"]')].map((e) => e.getAttribute('aria-label') ?? e.textContent);
    const at = (name: string) => parts.findIndex((p) => p === name || p?.startsWith(name));
    const order = ['Show all tools', 'Brush tool', 'Size', 'Opacity', 'Color', 'Eraser', 'Settings'].map(at);
    expect(order.every((i) => i >= 0), JSON.stringify(parts)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(quick()!.querySelector('[aria-label="Text"]')).toBeNull();
  });

  it('« restores the full tool list', async () => {
    await click('Brush'); await click('Show all tools');
    expect(quick()).toBeNull();
    expect(host.querySelector('[aria-label="Tools"] [aria-label="Text"]')).toBeTruthy();
  });

  it('the advanced card does not open when the tool is chosen; the gear opens and closes it', async () => {
    await click('Brush');
    expect(host.querySelector('.tool-dock-card')).toBeNull();
    await click('Settings');
    expect(host.querySelector('[aria-label="Brush settings"]')).toBeTruthy();
    expect(btn('Settings').getAttribute('aria-pressed')).toBe('true');
    await click('Settings');
    expect(host.querySelector('.tool-dock-card')).toBeNull();
  });

  it('the Eraser button switches brush and eraser and back', async () => {
    await click('Brush');
    await click('Eraser');
    expect(useStore.getState().ui.tool).toBe('eraser');
    expect(btn('Eraser').getAttribute('aria-pressed')).toBe('true');
    expect(quick()!.querySelector('[aria-label^="Color"]')).toBeNull();
    await click('Eraser');
    expect(useStore.getState().ui.tool).toBe('brush');
  });

  it('the variants row is the fixed one, above the toolbox, with 36 px targets', async () => {
    await click('Brush');
    expect(host.querySelector('.tool-dock-stack.is-fixed .tool-dock-variants.is-fixed')).toBeTruthy();
    const css = readFileSync('src/styles/tool-dock.css', 'utf8');
    expect(css).toMatch(/\.tool-dock-variants\.is-fixed \.icon-btn \{ width: 36px; height: 36px; \}/);
    expect(css).toMatch(/\.tool-dock-stack\.is-fixed \{ align-items: flex-start; \}/);
  });

  it('the hide-prompt button is labelled, toggles aria-pressed and persists in the ui state', async () => {
    expect(btn('Hide prompt box').getAttribute('aria-pressed')).toBe('false');
    await click('Hide prompt box');
    expect(btn('Hide prompt box').getAttribute('aria-pressed')).toBe('true');
    expect(useStore.getState().ui.promptHidden).toBe(true);
    expect(pickUi(useStore.getState().ui).promptHidden).toBe(true);
    await click('Hide prompt box');
    expect(useStore.getState().ui.promptHidden).toBe(false);
  });

  it('the composer box hides with the flag and the toolbox stays', () => {
    const src = readFileSync('src/components/composer/Composer.tsx', 'utf8');
    expect(src).toMatch(/showTools && promptHidden \? ' is-prompt-hidden'/);
    expect(readFileSync('src/styles/tool-dock.css', 'utf8')).toMatch(/\.composer\.is-prompt-hidden \.composer-footer/);
  });
});
