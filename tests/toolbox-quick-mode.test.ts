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

  it('the subtoolbox is as wide as the toolbox and centered, with 36 px buttons and no floating gutter', () => {
    const css = readFileSync('src/styles/tool-dock.css', 'utf8');
    expect(css).toMatch(/\.tool-dock-stack\.is-fixed \{ align-items: center;/);
    expect(css).toMatch(/> \.tool-dock-variants\.is-fixed \{ width: 100%;/);
    expect(css).toMatch(/\.tool-dock-variants\.is-fixed \.icon-btn \{ width: 36px; height: 36px; \}/);
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

  it('hiding slides the toolbox down with a transition (reduced motion respected) and drops the subtoolbox to the bottom', () => {
    expect(readFileSync('src/components/composer/Composer.tsx', 'utf8')).toMatch(/showTools && promptHidden \? ' is-prompt-hidden'/);
    const css = readFileSync('src/styles/tool-dock.css', 'utf8');
    expect(css).toMatch(/\.composer\.is-prompt-hidden .*\.tool-dock-family\) \{ transform: translateY\(/);
    expect(css).toMatch(/\.composer\.is-prompt-hidden \.tool-dock-stack\.is-fixed \{ bottom: 8px; right: 47px; \}/);
    expect(css).toMatch(/\.tool-dock-hide-prompt\.is-pill \{ position: absolute;[^}]*bottom: 8px;/);
    expect(css).toMatch(/transition: transform \.22s/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^}]*transition: none/);
  });
});

it('the quick colour sits on a light disc and the tools-dock frame is thin', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles/tool-dock.css', 'utf8');
  expect(css).toMatch(/\.tool-dock-variants\.is-fixed \.opt-color\.is-icon \{ background: var\(--text\)/);
  expect(readFileSync('src/styles/prompt-box.css', 'utf8')).toMatch(/\.composer-dock\.dock-designer::before \{ inset: -4px -4px -40px;/);
});

describe('hide button placement', () => {
  it('the hide button is the last item of the toolbox bar after a divider; hidden, it becomes a pill outside the bar and still unhides', async () => {
    const bar = () => host.querySelector('[aria-label="Tools"]')!;
    expect(bar().querySelector('.tool-dock-end:last-child > .tool-dock-separator + [aria-label="Hide prompt box"]')).toBeTruthy();
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
  const row = () => host.querySelector('.tool-dock-variants');
  const labels = (el: Element | null) => [...(el?.querySelectorAll('button, .opt-label') ?? [])].map((e) => e.getAttribute('aria-label') ?? e.textContent);

  it('Eraser (a single tool) starts with its quick settings: no repeated icon, no chevron; Size, Opacity, toggle and gear', async () => {
    await click('Eraser');
    const l = labels(row());
    expect(l.slice(0, 2)).toEqual(['Size', expect.anything()]);
    expect(l).toEqual(expect.arrayContaining(['Size', 'Opacity', 'Eraser', 'Settings']));
    expect(l).not.toContain('Hide tool settings'); expect(l).not.toContain('Show tool settings');
    expect(row()!.querySelectorAll('button[aria-label="Eraser"]').length).toBe(1);
    expect(row()!.querySelector('button[aria-label="Eraser tool"]')).toBeNull();
  });

  it('Ruler shows its three subtools, a divider and its quick settings (Snap, Clear), then the gear', async () => {
    await click('Ruler');
    const l = labels(row());
    expect(l.slice(0, 3)).toEqual(['Straight ruler', 'Ellipse ruler', 'Perspective ruler']);
    expect(row()!.querySelector('.tool-dock-separator')).toBeTruthy();
    expect(l).toEqual(expect.arrayContaining(['Snap', 'Clear', 'Settings']));
  });

  it('Text row comes from the mapping: font size and color, then the gear that toggles its card', async () => {
    await click('Text');
    expect(labels(row())).toEqual(expect.arrayContaining(['Size', expect.stringMatching(/^Color/), 'Settings']));
    expect(host.querySelector('.tool-dock-card')).toBeNull();
    await act(async () => row()!.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')!.click());
    expect(host.querySelector('[aria-label="Text settings"]')).toBeTruthy();
    await act(async () => row()!.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')!.click());
    expect(host.querySelector('.tool-dock-card')).toBeNull();
  });

  it('a tool with neither subtools nor settings shows no row at all', async () => {
    const tools = new Set(['hand']) as unknown as ReadonlySet<never>;
    await act(async () => { setUi({ tool: 'hand' }); root.render(createElement(ToolDock, { sessionId: 'test', doc: { ...createDoc('Dock', 100, 100), paintMode: 'drawing' }, designer: true, tools })); });
    await click('Edit');
    expect(row()).toBeNull();
  });

  it('QUICK maps every control to at most 2 long sliders', async () => {
    const { QUICK } = await import('../src/components/designer/QuickSettings');
    for (const [tool, kinds] of Object.entries(QUICK)) expect(kinds!.filter((k) => /size|opacity|threshold|Width|fontSize/i.test(k)).length, tool).toBeLessThanOrEqual(2);
  });
});
