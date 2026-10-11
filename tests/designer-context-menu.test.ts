// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { ToolRail } from '../src/components/designer/ToolRail';
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
  await act(async () => root.render(createElement(ToolRail, { sessionId: 'test', doc })));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  useStore.setState({ ui: initialUi }); vi.unstubAllGlobals();
});
const strip = () => host.querySelector('.context-strip');
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label || b.querySelector('.menu-label')?.textContent === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}

it('opens by default, toggles on the active tool, and keeps that tool selected', async () => {
  expect(strip()).toBeTruthy();
  await click('Brush (B)'); expect(strip()).toBeNull();
  expect(useStore.getState().ui.tool).toBe('brush');
  await click('Brush (B)'); expect(strip()).toBeTruthy();
});
it('switches the settings to another tool and reopens after a keyboard tool change', async () => {
  await click('Brush (B)');
  await click('Text (T)'); expect(strip()?.getAttribute('aria-label')).toBe('Text quick settings');
  await click('Text (T)'); expect(strip()).toBeNull();
  await act(async () => setUi({ tool: 'ruler' }));
  expect(strip()?.getAttribute('aria-label')).toBe('Ruler quick settings');
});
it('replaces the strip with a group menu and restores it even when choosing the current group tool', async () => {
  await click('Fill and gradient'); expect(strip()).toBeNull();
  await click('Fill'); expect(strip()?.getAttribute('aria-label')).toBe('Fill quick settings');
  await click('Fill and gradient · Fill'); expect(strip()).toBeNull();
  await click('Fill'); expect(strip()).toBeTruthy();
});
it('hides for Snap and Add, while a settings field keeps the strip open', async () => {
  await click('Color · #ffffff'); expect(strip()).toBeTruthy();
  await click('Snap'); expect(strip()).toBeNull();
  await click('Brush (B)'); expect(strip()).toBeTruthy();
  await click('Add'); expect(strip()).toBeNull();
});
