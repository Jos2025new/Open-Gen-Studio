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

const sub = async (label: string) => { const b = host.querySelector<HTMLButtonElement>(`[aria-label="Brush variants"] button[aria-label="${label}"]`); expect(b, label).toBeTruthy(); await act(async () => b!.click()); };
const enter = async () => { await click('Brush'); await sub('Brush'); }; // family button, then the Brush subtool

describe('quick mode of the subtoolbox', () => {
  it('choosing the Brush subtool shows « , its icon, Size and Opacity, the color, Eraser and Settings in that order, inside the subtoolbox; the main toolbox keeps every tool', async () => {
    await enter();
    expect(quick()).toBeTruthy();
    expect(quick()!.classList.contains('tool-dock-variants')).toBe(true);
    expect(host.querySelector('[aria-label="Tools"] [aria-label="Text"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Brush variants"]')).toBeNull();
    const parts = [...quick()!.querySelectorAll('button, .opt-label')].map((e) => e.getAttribute('aria-label') ?? e.textContent);
    const at = (name: string) => parts.findIndex((p) => p === name || p?.startsWith(name));
    const order = ['Show all tools', 'Brush tool', 'Size', 'Opacity', 'Color', 'Eraser', 'Settings'].map(at);
    expect(order.every((i) => i >= 0), JSON.stringify(parts)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('« expands the row back to all the subtools', async () => {
    await enter(); await click('Show all tools');
    expect(quick()).toBeNull();
    expect(host.querySelector('[aria-label="Brush variants"] [aria-label="Pencil"]')).toBeTruthy();
    await sub('Pencil');
    expect(quick()).toBeTruthy();
  });

  it('the advanced card does not open when the subtool is chosen; the gear opens and closes it', async () => {
    await enter();
    expect(host.querySelector('.tool-dock-card')).toBeNull();
    await click('Settings');
    expect(host.querySelector('[aria-label="Brush settings"]')).toBeTruthy();
    expect(btn('Settings').getAttribute('aria-pressed')).toBe('true');
    await click('Settings');
    expect(host.querySelector('.tool-dock-card')).toBeNull();
  });

  it('the Eraser button switches brush and eraser and back', async () => {
    await enter();
    const toggle = () => act(async () => quick()!.querySelector<HTMLButtonElement>('button[aria-label="Eraser"]')!.click());
    await toggle();
    expect(useStore.getState().ui.tool).toBe('eraser');
    expect(quick()!.querySelector('button[aria-label="Eraser"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(quick()!.querySelector('[aria-label^="Color"]')).toBeNull();
    await toggle();
    expect(useStore.getState().ui.tool).toBe('brush');
  });

  it('the subtoolbox is as wide as the toolbox and centered, with 36 px buttons and the hide button in its own gutter', () => {
    const css = readFileSync('src/styles/tool-dock.css', 'utf8');
    expect(css).toMatch(/\.tool-dock-stack\.is-fixed \{ align-items: center;/);
    expect(css).toMatch(/> \.tool-dock-variants\.is-fixed \{ width: 100%;/);
    expect(css).toMatch(/\.tool-dock-variants\.is-fixed \.icon-btn \{ width: 36px; height: 36px; \}/);
    expect(css).toMatch(/\.tool-dock-hide-prompt \{[^}]*right: -46px;/);
  });

  it('the hide-prompt button is labelled, toggles aria-pressed and persists in the ui state', async () => {
    expect(btn('Hide prompt box').getAttribute('aria-pressed')).toBe('false');
    await click('Hide prompt box');
    expect(btn('Hide prompt box').getAttribute('aria-pressed')).toBe('true');
    expect(pickUi(useStore.getState().ui).promptHidden).toBe(true);
    await click('Hide prompt box');
    expect(useStore.getState().ui.promptHidden).toBe(false);
  });

  it('hiding slides the toolbox down with a transition (reduced motion respected) and drops the subtoolbox to the bottom', () => {
    expect(readFileSync('src/components/composer/Composer.tsx', 'utf8')).toMatch(/showTools && promptHidden \? ' is-prompt-hidden'/);
    const css = readFileSync('src/styles/tool-dock.css', 'utf8');
    expect(css).toMatch(/\.composer\.is-prompt-hidden .*\.tool-dock-family\) \{ transform: translateY\(/);
    expect(css).toMatch(/\.composer\.is-prompt-hidden \.tool-dock-stack\.is-fixed \{ bottom: 8px; \}/);
    expect(css).toMatch(/transition: transform \.22s/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^}]*transition: none/);
  });
});
