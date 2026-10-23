// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { ToolDock } from '../src/components/designer/ToolDock';
import { createDoc, newRasterLayer } from '../src/engine/design/doc';
import { setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialUi = useStore.getState().ui;
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useStore.setState({ ui: { ...initialUi, tool: 'brush' } });
  const doc = createDoc('Menus', 100, 100);
  const layer = newRasterLayer('Paint', { x: 0, y: 0, width: 100, height: 100 }, { width: 100, height: 100 });
  doc.layers = [layer]; doc.activeLayerId = layer.id;
  host = document.createElement('div'); host.className = 'composer-tools-bar'; document.body.append(host);
  const add = document.createElement('button'); add.textContent = 'Add'; host.append(add);
  const palette = document.createElement('div'); palette.className = 'designer-palette'; host.append(palette);
  root = createRoot(palette);
  await act(async () => root.render(createElement(ToolDock, { sessionId: 'test', doc })));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  useStore.setState({ ui: initialUi }); vi.unstubAllGlobals();
});
const variants = () => host.querySelector('.tool-dock-variants');
async function click(label: string, scope = 'body') {
  const button = [...document.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find((b) => b.getAttribute('aria-label') === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}

it('opens a family, toggles its active variant, and keeps that tool selected', async () => {
  expect(variants()).toBeTruthy();
  await click('Brush', '.tool-dock-variants'); expect(host.querySelector('[aria-label="Brush settings"]')).toBeTruthy();
  expect(useStore.getState().ui.tool).toBe('brush');
  await click('Hide tool settings'); expect(host.querySelector('[aria-label="Brush settings"]')).toBeNull();
  await click('Brush', '.tool-dock-family'); expect(variants()).toBeNull();
});
it('switches the settings to another tool and follows keyboard tool changes', async () => {
  await click('Pencil'); expect(host.querySelector('[aria-label="Pencil settings"]')).toBeTruthy();
  expect(useStore.getState().ui.tool).toBe('brush');
  await act(async () => setUi({ tool: 'ruler' }));
  expect(variants()?.getAttribute('aria-label')).toBe('Ruler variants');
});
it('opens variants for a selected family and activates its tool', async () => {
  await click('Edit', '.tool-dock-family'); await click('Brush', '.tool-dock-family');
  expect(variants()?.getAttribute('aria-label')).toBe('Brush variants');
  await click('Fill');
  expect(useStore.getState().ui.tool).toBe('fill');
  expect(host.querySelector('[aria-label="Fill settings"]')).toBeTruthy();
});
it('retains the real Add control and includes Layers in the dock, without the mode switch', async () => {
  expect(host.querySelector('button')?.textContent).toBe('Add');
  expect(host.querySelector('.tool-dock')?.contains(host.querySelector('button'))).toBe(false);
  expect([...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Show or hide right panel')).toBe(true);
  expect(host.querySelector('.tool-dock-family .paint-mode')).toBeNull();
  await click('Brush'); expect(variants()).toBeTruthy();
});
