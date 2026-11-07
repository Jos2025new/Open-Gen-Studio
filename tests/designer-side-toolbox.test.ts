// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { announceSidePopup, ToolDock } from '../src/components/designer/ToolDock';
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

it('the tool help sits in the right panel and its handle; neither the bar nor the toolbox carries it', () => {
  expect(readFileSync('src/components/designer/ToolDock.tsx', 'utf8')).not.toContain('{place}');
  expect(readFileSync('src/components/designer/LayersPeek.tsx', 'utf8')).toContain('<ViewToggles tipSide="right" />');
  expect(readFileSync('src/components/designer/LayersPanel.tsx', 'utf8')).toContain('<ViewToggles />');
  expect(readFileSync('src/components/designer/DesignerWorkspace.tsx', 'utf8')).not.toContain('<ViewToggles');
  expect(readFileSync('src/components/studio/EmbeddedDesignerBar.tsx', 'utf8')).not.toMatch(/<ToolDock[^>]* designer[ />]/);
});

it('the toolbox is always upright at the left; the bottom holds the active tool\'s options or the prompt box', () => {
  const palette = readFileSync('src/components/designer/ToolPalette.tsx', 'utf8');
  expect(palette).toMatch(/<div className="designer-side">\s*<DesignsButton [^>]*\/>\s*<CornerButtons [^>]*\/>\s*<span className="tool-dock-separator" aria-hidden="true" \/>\s*<div className="designer-palette is-side">\s*<ToolDock [^>]*vertical designer optionsSlot=\{slot\} \/>\s*<\/div>\s*<div className="designer-view"/);
  expect(palette).not.toContain('createPortal');
  expect(readFileSync('src/components/composer/Composer.tsx', 'utf8')).toMatch(/<DockSlot \/><\/ScrollRail>/);
  const dock = readFileSync('src/components/designer/ToolDock.tsx', 'utf8');
  expect(dock).toMatch(/const placeStack = [^\n]*optionsSlot \? createPortal\(stack, optionsSlot\) : null;/);
  expect(dock).toMatch(/if \(designer\) \{ announceSidePopup\('tools'\); setUi\(\{ designerDock: 'tools' \}\); \}/);
  expect(readFileSync('src/components/node/NodeSide.tsx', 'utf8')).toMatch(/if \(v === 'chat'\) setUi\(\{ designerDock: open && view === 'chat' \? 'tools' : 'prompt' \}\);/);
  const css = readFileSync('src/styles/tool-dock.css', 'utf8');
  expect(css).toMatch(/\.designer:has\(\.designer-side\) \.document-picker \{ display: none; \}/);
  expect(css).toMatch(/\.ws-designer:has\(\.designer-side\) \{ --designer-dock-left: max\(5\.25rem/);
});

it('side toolbox, one popup at a time: another popup closes the tool\'s; a family announces its own; the flat strip ignores it', async () => {
  const seen: string[] = [];
  const spy = (e: Event) => seen.push((e as CustomEvent<string>).detail);
  window.addEventListener('ogs:side-popup', spy);
  const upright = await render(true, 'Brush');
  expect(seen).toEqual(['tools']);
  expect(upright.host.querySelector('[aria-label="Brush variants"]')).not.toBeNull();
  act(() => announceSidePopup('corner'));
  expect(upright.host.querySelector('[aria-label="Brush variants"]')).toBeNull();
  await upright.done();
  const flat = await render(false, 'Brush');
  expect(seen).toEqual(['tools', 'corner']);
  act(() => announceSidePopup('designs'));
  expect(flat.host.querySelector('[aria-label="Brush variants"]')).not.toBeNull();
  await flat.done();
  window.removeEventListener('ogs:side-popup', spy);
  const sources = ['src/components/designer/ToolPalette.tsx', 'src/components/node/NodeSide.tsx'].map((f) => readFileSync(f, 'utf8')).join('\n');
  expect(sources).toMatch(/useSidePopup\('designs', pop\.close\)/);
  expect(readFileSync('src/components/designer/ToolDock.tsx', 'utf8')).toMatch(/const designer = vertical \|\| inDesigner;\s*useSidePopup\('tools', [^\n]*, designer\);/);
  expect(sources).toMatch(/useSidePopup\('corner', \(\) => useCorner\.setState\(\{ open: false \}\)\)/);
  expect(sources).toMatch(/if \(space === 'designer'\) \{\s*announceSidePopup\('corner'\)/);
});

it('top bar: new document and undo/redo beside the title, Save to gallery and the panel in one group, Export the one primary button', () => {
  const ws = readFileSync('src/components/designer/DesignerWorkspace.tsx', 'utf8');
  expect(ws).toMatch(/<TopbarActions side="start">\s*<span className="topbar-group" role="toolbar" aria-label="Document history">\s*<IconButton [^>]*label="New document"[\s\S]*?label="Undo"[\s\S]*?label="Redo"/);
  expect(ws).toMatch(/aria-label="Document">\s*<IconButton [^>]*label="Save to gallery"[^\n]*\/>\s*<span className="topbar-sep" aria-hidden \/>\s*<IconButton [^>]*label="Show or hide right panel"/);
  // Import (the prompt box's +), Transform (Edit) and Canvas size (toolbox) are not repeated in the top bar.
  expect(ws).not.toMatch(/label="Import image"|<EditOps |<CanvasSize /);
  expect(readFileSync('src/components/composer/ComposerOptions.tsx', 'utf8')).toContain('Upload image to {canvasName}');
  expect(readFileSync('src/components/designer/ToolDock.tsx', 'utf8')).toContain("selectedVariant.action === 'size' && <div className=\"tool-dock-actions\"><CanvasSize");
  expect(ws).toMatch(/className="topbar-export" variant="primary"/);
  expect(readFileSync('src/components/shell/TopBar.tsx', 'utf8')).toMatch(/<\/>\}\s*\{\/\*[^*]*\*\/\}\s*<div id="workspace-actions-start" className="topbar-slot topbar-slot-start" \/>/);
});

it('the side toolbox wears the main bar\'s frame and one icon grey', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles/tool-dock.css', 'utf8');
  expect(css).toMatch(/\.designer-side \{[^}]*border: 1px solid var\(--bar-line\); border-radius: var\(--r-m\); background: var\(--bar-bg\); \}/);
  expect(css).toMatch(/\.designer-side \.icon-btn:not\([^)]*\) svg \{ color: var\(--text-3\); \}/);
});
