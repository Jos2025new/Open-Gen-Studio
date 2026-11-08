// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { ToolDock } from '../src/components/designer/ToolDock';
import { createDoc } from '../src/engine/design/doc';
import { pickUi } from '../src/store/persistUi';
import { setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialUi = useStore.getState().ui;
let root: Root, host: HTMLDivElement, optionsSlot: HTMLElement;

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  useStore.setState({ ui: { ...initialUi, tool: 'move', selectShape: 'rect', promptHidden: false } });
  host = document.createElement('div'); document.body.append(host);
  host.innerHTML = '<div class="composer"><div class="composer-tools-bar"><div class="designer-dock-options"></div><span class="tool-dock-eye-slot"></span></div></div><div class="mount"></div>';
  optionsSlot = host.querySelector<HTMLElement>('.designer-dock-options')!;
  root = createRoot(host.querySelector('.mount')!);
  await act(async () => root.render(createElement(ToolDock, { sessionId: 'test', doc: { ...createDoc('Dock', 100, 100), paintMode: 'drawing' }, designer: true, optionsSlot })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useStore.setState({ ui: initialUi }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const btn = (label: string) => [...host.querySelectorAll('button')].filter((b) => b.getAttribute('aria-label') === label).at(-1)!;
const click = async (label: string) => { expect(btn(label), label).toBeTruthy(); await act(async () => btn(label).click()); };
const quick = () => host.querySelector('[aria-label="Quick settings"]');

const grid = async (label: string) => { // the Tools button opens the popup grid; pick a cell by its label
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label')?.startsWith('Tools · '))!.click());
  const cell = [...document.querySelectorAll<HTMLButtonElement>('.tools-grid-pop .menu-item')].find((b) => b.textContent === label);
  expect(cell, label).toBeTruthy(); await act(async () => cell!.click());
};
const enter = async () => grid('Brush');

describe('quick settings above the toolbox', () => {
  it('the row is always there for a tool with settings: the tool icon, Size, Opacity, Flow, Color and Eraser in that order; Settings is in the main toolbox, not the row', async () => {
    await enter();
    expect(quick()).toBeTruthy();
    expect(quick()!.classList.contains('tool-dock-variants')).toBe(true);
    expect(host.querySelector('[aria-label="Tools"] [aria-label="Text"]')).toBeTruthy();
    const parts = [...quick()!.querySelectorAll('button, .opt-label')].map((e) => e.getAttribute('aria-label') ?? e.textContent);
    const at = (name: string) => parts.findIndex((p) => p === name || p?.startsWith(name));
    const order = ['Brush tool', 'Size', 'Opacity', 'Flow', 'Color', 'Eraser'].map(at);
    expect(order.every((i) => i >= 0), JSON.stringify(parts)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(parts).not.toContain('Settings');
    expect(host.querySelector('[aria-label="Tools"] button[aria-label="Settings"]')).toBeTruthy();
  });

  it('there is no toggle between the row and the variants: no « button, and the row stays after choosing any tool of the grid', async () => {
    await enter();
    expect(host.querySelector('[aria-label="Show all tools"]')).toBeNull();
    await grid('Pencil');
    expect(quick()).toBeTruthy();
    await grid('Lineart');
    expect(quick()).toBeTruthy();
    expect(host.querySelector('[aria-label="Brush variants"]')).toBeNull();
  });

  it('the Tools grid holds Select, Ruler, Pen, Brush and Eraser with their variants, and those have no button of their own', async () => {
    const bar = [...host.querySelectorAll('[aria-label="Tools"] > span > button')].map((b) => b.getAttribute('aria-label'));
    for (const own of ['Select', 'Ruler', 'Pen', 'Brush', 'Eraser']) expect(bar, own).not.toContain(own);
    expect(bar.filter((l) => l?.startsWith('Tools · '))).toHaveLength(1);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label')?.startsWith('Tools · '))!.click());
    const cells = [...document.querySelectorAll('.tools-grid-pop .menu-item')].map((b) => b.textContent);
    expect(cells).toEqual(expect.arrayContaining(['Rectangular selection', 'Lasso', 'Magic wand', 'Straight ruler', 'Lineart', 'Curve', 'Bezier pen', 'Cutter', 'Brush', 'Pencil', 'Airbrush', 'Eraser']));
  });

  it('the toolbox order is Tools, tool settings, Text, Layout, then the Layers button; Edit keeps its place before Tools', () => {
    const labels = [...host.querySelectorAll('[aria-label="Tools"] button')].map((b) => b.getAttribute('aria-label')!);
    const at = (name: string) => labels.findIndex((l) => l === name || l.startsWith(name));
    const order = ['Edit', 'Tools · ', 'Settings', 'Text', 'Layout', 'Show or hide right panel'].map(at);
    expect(order.every((i) => i >= 0), JSON.stringify(labels)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('the advanced card does not open when the tool is chosen; the gear opens and closes it', async () => {
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

  it('the rows are as wide as their content and centered: no grow spacer, no space-between, no full-width rule', () => {
    const css = readFileSync('src/styles/tool-dock.css', 'utf8');
    expect(css).toMatch(/\.tool-dock-stack\.is-fixed \{ align-items: center;/);
    expect(css).not.toMatch(/\.designer-dock-options \.tool-dock-variants\.is-fixed \{ justify-content: space-between/);
    expect(css).not.toMatch(/is-fixed \{ width: 100%/);
    expect(readFileSync('src/components/designer/ToolDock.tsx', 'utf8')).not.toMatch(/quickShown|enterQuick|collapsibleFor|hasQuickCollapsible|rowFits/);
    expect(css).not.toMatch(/right: -46px/);
  });

it('the hide-prompt button is labelled, toggles aria-pressed and persists in the ui state', async () => {
    expect(btn('Hide prompt box').getAttribute('aria-pressed')).toBe('false');
    await click('Hide prompt box');
    expect(btn('Hide prompt box').getAttribute('aria-pressed')).toBe('true');
    expect(pickUi(useStore.getState().ui).promptHidden).toBe(true);
    await click('Hide prompt box');
    expect(useStore.getState().ui.promptHidden).toBe(false);
  });

  it('hiding slides the bar down with a transition (reduced motion respected)', () => {
    expect(readFileSync('src/components/composer/Composer.tsx', 'utf8')).toMatch(/showTools && promptHidden \? ' is-prompt-hidden'/);
    const css = readFileSync('src/styles/tool-dock.css', 'utf8');
    expect(css).toMatch(/\.composer\.is-prompt-hidden \.composer-tools-bar > \* \{ transform: translateY\(/);
    expect(css).toMatch(/\.composer\.is-prompt-hidden \.tool-dock-stack\.is-fixed \{ bottom: 0\.5rem; right: 2\.9375rem; \}/);
    expect(css).toMatch(/\.tool-dock-hide-prompt\.is-pill \{ position: absolute;[^}]*bottom: 0\.5rem;/);
    expect(css).toMatch(/transition: transform \.22s/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^}]*transition: none/);
  });
});

it('the quick colour sits on a light disc and the tools-dock frame is thin', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles/tool-dock.css', 'utf8');
  expect(css).toMatch(/\.tool-dock-variants\.is-fixed \.opt-color\.is-icon \{ background: var\(--text-3\)/);
  expect(readFileSync('src/styles/prompt-box.css', 'utf8')).toMatch(/\.composer-dock\.dock-designer::before \{ inset: -0\.25rem -100vw -2\.5rem;/);
});

describe('hide button placement', () => {
  it('the hide button is the last item of the toolbox bar after a divider; hidden, it becomes a pill outside the bar and still unhides', async () => {
    const bar = () => host.querySelector('.composer-tools-bar')!;
    expect(bar().querySelector('.tool-dock-eye-slot > .tool-dock-separator + [aria-label="Hide prompt box"]')).toBeTruthy();
    await click('Hide prompt box');
    expect(bar().querySelector('[aria-label="Hide prompt box"]')).toBeNull();
    const pill = host.querySelector('.tool-dock-hide-prompt.is-pill')!;
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    await act(async () => (pill as HTMLButtonElement).click());
    expect(useStore.getState().ui.promptHidden).toBe(false);
    expect(bar().querySelector('[aria-label="Hide prompt box"]')).toBeTruthy();
  });
});

describe('subtoolbox row for every tool', () => {
  const row = () => host.querySelector('.tool-dock-variants.is-quick');
  const labels = (el: Element | null) => [...(el?.querySelectorAll('button, .opt-label') ?? [])].map((e) => e.getAttribute('aria-label') ?? e.textContent);

  it('Eraser (a single tool) starts with its quick settings: no chevron; Size, Opacity and toggle', async () => {
    await grid('Eraser');
    const l = labels(row());
    expect(l.slice(0, 2)).toEqual(['Size', expect.anything()]);
    expect(l).toEqual(expect.arrayContaining(['Size', 'Opacity', 'Eraser']));
    expect(l).not.toContain('Hide tool settings'); expect(l).not.toContain('Show tool settings');
    expect(row()!.querySelectorAll('button[aria-label="Eraser"]').length).toBe(1);
  });

  it('Ruler keeps its three subtools in the Tools grid and its quick settings (Snap, Clear) in the quick row', async () => {
    await grid('Straight ruler');
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label')?.startsWith('Tools · '))!.click());
    const cells = [...document.querySelectorAll('.tools-grid-pop .menu-item')].map((b) => b.textContent);
    expect(cells).toEqual(expect.arrayContaining(['Straight ruler', 'Ellipse ruler', 'Perspective ruler']));
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label')?.startsWith('Tools · '))!.click());
    expect(labels(row())).toEqual(expect.arrayContaining(['Snap', 'Clear']));
  });

  it('Text row comes from the mapping: font size and color; the toolbox Settings button opens the card alone and closes it', async () => {
    await click('Text');
    expect(labels(row())).toEqual(expect.arrayContaining(['Size', expect.stringMatching(/^Color/)]));
    expect(host.querySelector('.tool-dock-card')).toBeNull();
    await click('Settings');
    expect(host.querySelector('[aria-label="Text settings"]')).toBeTruthy();
    expect(quick()).toBeNull(); // the card shows alone
    await click('Settings');
    expect(host.querySelector('.tool-dock-card')).toBeNull();
  });

  it('a tool with neither subtools nor settings shows no row at all', async () => {
    const tools = new Set(['hand']) as unknown as ReadonlySet<never>;
    await act(async () => { setUi({ tool: 'hand' }); root.render(createElement(ToolDock, { sessionId: 'test', doc: { ...createDoc('Dock', 100, 100), paintMode: 'drawing' }, designer: true, optionsSlot, tools })); });
    await click('Pan');
    expect(row()).toBeNull();
  });

  it('every tool with settings has essentials: the selection acts, the gradient shows its opacity without a saved gradient, the eyedropper leaves no empty slider slot', async () => {
    await grid('Rectangular selection');
    expect(labels(row())).toEqual(expect.arrayContaining(['Mode', 'All', 'Invert']));
    await act(async () => setUi({ selectShape: 'wand' }));
    expect(labels(row())).toEqual(expect.arrayContaining(['Mode', 'Tolerance', 'Grow / shrink']));
    expect(labels(row())).not.toContain('All');
    await act(async () => setUi({ selectShape: 'rect' }));
    await act(async () => setUi({ tool: 'gradient', gradient: undefined }));
    expect(row()!.querySelector('.tool-dock-quick-sliders .opt-slider')).not.toBeNull();
    const second = () => row()!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(second().getAttribute('aria-checked')).toBe('false');
    expect(row()!.querySelectorAll('.quick-color-pair .opt-color')).toHaveLength(2); // always both; the second is faded while the gradient fades out
    await act(async () => second().click());
    expect(useStore.getState().ui.gradient?.mode).toBe('two');
    expect(row()!.querySelectorAll('.quick-color-pair .opt-color')).toHaveLength(2);
    await act(async () => setUi({ tool: 'eyedropper' }));
    expect(labels(row())).toEqual(expect.arrayContaining(['Radius', 'Sample']));
    expect(row()!.querySelector('[aria-label="Settings"]')).toBeNull();
  });

  it('the brush row keeps Size, Opacity, Flow and the colors, with Blend and Lock alpha in the card', async () => {
    const { QUICK } = await import('../src/components/designer/QuickSettings');
    expect(QUICK.brush).toEqual(['size', 'opacity', 'flow', 'colorPair']);
  });

  it('QUICK maps every control to at most 2 long sliders', async () => {
    const { QUICK } = await import('../src/components/designer/QuickSettings');
    for (const [tool, kinds] of Object.entries(QUICK)) expect(kinds!.filter((k) => /size|opacity|threshold|Width|fontSize/i.test(k)).length, tool).toBeLessThanOrEqual(2);
  });
});

it('the eye goes to the bar end slot after the zoom rail, not inside the scrolling tool list', async () => {
  const { readFileSync } = await import('node:fs');
  expect(readFileSync('src/components/composer/Composer.tsx', 'utf8')).toMatch(/<DockSlot at="bar" \/><\/ScrollRail><span className="tool-dock-eye-slot" \/>/);
  expect(readFileSync('src/components/designer/ToolDock.tsx', 'utf8')).toMatch(/createPortal\([^;]*hideButton[^;]*eyeSlot\)/);
});
