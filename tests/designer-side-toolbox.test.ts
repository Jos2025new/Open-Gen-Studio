// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { ToolDock } from '../src/components/designer/ToolDock';
import { createDoc } from '../src/engine/design/doc';
import { useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialUi = useStore.getState().ui;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  useStore.setState({ ui: { ...initialUi, tool: 'move', selectShape: 'rect' } });
});
afterEach(() => { useStore.setState({ ui: initialUi }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function render(vertical: boolean, family?: string) {
  useStore.setState({ ui: { ...initialUi, tool: 'move', selectShape: 'rect' } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(ToolDock, { sessionId: 'test', doc: { ...createDoc('Dock', 100, 100), paintMode: 'drawing' }, vertical })));
  if (family) await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === family)?.click());
  const labels = [...host.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
  return { host, labels, done: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it('the side toolbox is the same strip turned upright: every button, in the same order, closed and with a family open', async () => {
  for (const family of [undefined, 'Brush', 'Layout', 'Edit']) {
    const flat = await render(false, family);
    const upright = await render(true, family);
    expect(upright.labels.length).toBeGreaterThan(5);
    expect(upright.labels).toEqual(flat.labels);
    expect(upright.host.querySelector('.tool-dock.is-vertical [aria-label="Tools"]')?.getAttribute('aria-orientation')).toBe('vertical');
    expect(flat.host.querySelector('[aria-label="Tools"]')?.hasAttribute('aria-orientation')).toBe(false);
    await flat.done(); await upright.done();
  }
});

it('arrows Up and Down move along the upright strip; Left and Right still work', async () => {
  const { host, done } = await render(true);
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Tools"] button:not(:disabled)')];
  buttons[0].focus();
  act(() => { buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  expect(document.activeElement).toBe(buttons[1]);
  act(() => { buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
  expect(document.activeElement).toBe(buttons[0]);
  act(() => { buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
  expect(document.activeElement).toBe(buttons[1]);
  await done();
});

it('upright, the popups are vertical too: variants in a column, the chevron points right, the grip resizes downward', async () => {
  const { host, done } = await render(true, 'Brush');
  expect(host.querySelector('[aria-label="Brush variants"]')?.getAttribute('aria-orientation')).toBe('vertical');
  expect(host.querySelector('.lucide-chevron-right')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Show tool settings"]')?.click());
  expect(host.querySelector('.lucide-chevron-left')).not.toBeNull();
  const grip = host.querySelector<HTMLButtonElement>('[aria-label="Resize tool settings"]')!;
  const card = () => host.querySelector<HTMLElement>('.tool-dock')!.style.getPropertyValue('--tool-dock-card-height');
  const before = card();
  act(() => { grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  expect(parseInt(card())).toBe(parseInt(before) + 16);
  await done();
});

it('the place button sits right after the panel buttons, in both places; Studio passes none', () => {
  const dock = readFileSync('src/components/designer/ToolDock.tsx', 'utf8');
  expect(dock).toMatch(/\{button\}\s*\{place\}\s*<\/span> : button;/);
  expect(readFileSync('src/components/studio/EmbeddedDesignerBar.tsx', 'utf8')).not.toContain('place=');
});

it('integrated (in the prompt box) or separate (upright at the left, with the designs and the canvas view in its frame): both modes stay', () => {
  const palette = readFileSync('src/components/designer/ToolPalette.tsx', 'utf8');
  expect(palette).toMatch(/if \(docked\) return viewBar;/);
  expect(palette).toMatch(/<IconButton icon=\{docked \? PanelLeft : PanelBottom\} label=\{docked \? 'Toolbox at the side' : 'Toolbox in the prompt box'\} size="md" onClick=\{\(\) => setUi\(\{ designerDock: docked \? 'prompt' : 'tools' \}\)\} \/>/);
  expect(palette).toMatch(/<div className="designer-side">\s*<DesignsButton [^>]*\/>\s*<span className="tool-dock-separator" aria-hidden="true" \/>\s*<div className="designer-palette is-side">\s*<ToolDock [^>]*vertical place=\{<DockPlaceButton \/>\} \/>\s*<\/div>\s*\{viewBar\}/);
  expect(palette).toMatch(/<Popover [^>]*placement="right-start"[^>]*className="designs-pop">\s*<DocumentChoices /);
  expect(readFileSync('src/components/composer/Composer.tsx', 'utf8')).toMatch(/<div className="designer-palette is-docked"><ToolDock sessionId=\{sessionId\} doc=\{designDoc\} place=\{<DockPlaceButton \/>\} \/><\/div>/);
  const css = readFileSync('src/styles/tool-dock.css', 'utf8');
  expect(css).toMatch(/\.designer-side \.designer-palette\.is-side \.tool-dock-stack \{ left: calc\(100% \+ var\(--toolbar-padding\) \+ 1px \+ var\(--canvas-pop-gap\)\);[^}]*flex-direction: row;/);
  expect(css).toMatch(/\.designer:has\(\.designer-side\) \.document-picker \{ display: none; \}/);
  expect(css).toMatch(/body:has\(\.designs-pop\) \.designer-side \.tool-dock-stack \{ display: none; \}/);
  expect(css).toMatch(/\.ws-designer:has\(\.designer-side\) \{ --designer-dock-left: max\(84px/);
});
