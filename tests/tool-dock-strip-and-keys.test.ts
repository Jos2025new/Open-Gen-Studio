// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { ToolDock } from '../src/components/designer/ToolDock';
import { createDoc, newRasterLayer } from '../src/engine/design/doc';
import { useObjectSelection } from '../src/engine/design/objectSelection';
import { useStore } from '../src/store/store';
import { toolKey } from '../src/engine/shortcuts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialUi = useStore.getState().ui;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { useStore.setState({ ui: initialUi }); useObjectSelection.setState({ byDoc: {} }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function render(vertical: boolean, selected: boolean) {
  useStore.setState({ ui: { ...initialUi, tool: 'move', selectShape: 'rect' } });
  const doc = createDoc('Dock', 100, 100);
  // The active layer alone is always set and is not a pick: only a picked object shows the strip.
  const layer = newRasterLayer('Layer 1', { x: 0, y: 0, width: 100, height: 100 }, { width: 100, height: 100 }); doc.layers = [layer]; doc.activeLayerId = layer.id;
  useObjectSelection.setState({ byDoc: selected ? { [doc.id]: { layerId: layer.id, ids: ['shape-1'] } } : {} });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(ToolDock, { sessionId: 'test', doc, vertical })));
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label);
  return { host, button, done: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it('tooltips add the key of a mapped tool; aria-label stays the plain name; unmapped tools and flavours get no suffix', async () => {
  expect(toolKey('brush')).toBe('B');
  expect(toolKey('curve')).toBeUndefined();
  const { host, button, done } = await render(false, false);
  expect(button('Brush')?.getAttribute('data-tip')).toBe('Brush  B');
  expect(button('Edit')?.getAttribute('data-tip')).toBe('Edit  V');
  expect(button('Layout')?.getAttribute('data-tip')).toBe('Layout');
  await act(async () => button('Brush')?.click());
  expect(button('Pencil')?.getAttribute('data-tip')).toBe('Pencil');
  expect(button('Fill')?.getAttribute('data-tip')).toBe('Fill  G');
  expect(host.querySelector('[data-tip*="Soon:"]')?.getAttribute('aria-label')).toContain('Soon:');
  await act(async () => button('Pen')?.click());
  expect(button('Curve')?.getAttribute('data-tip')).toBe('Curve');
  await done();
});

it('Edit with a selection shows the contextual strip by itself in both modes; nothing selected shows nothing; an open Edit card does not duplicate it', async () => {
  for (const vertical of [false, true]) {
    const none = await render(vertical, false);
    expect(none.host.querySelector('.tool-dock-strip')).toBeNull();
    await none.done();
    const some = await render(vertical, true);
    expect(some.host.querySelectorAll('.tool-dock-strip')).toHaveLength(1);
    expect(some.host.querySelector('.tool-dock-stack .tool-dock-strip')).not.toBeNull();
    await act(async () => some.button('Edit')?.click());
    await act(async () => some.host.querySelector<HTMLButtonElement>('[aria-label="Show tool settings"]')?.click());
    expect(some.host.querySelector('.edit-card')).not.toBeNull();
    expect(some.host.querySelector('.tool-dock-strip')).toBeNull();
    await act(async () => some.host.querySelector<HTMLButtonElement>('[aria-label="Hide tool settings"]')?.click());
    expect(some.host.querySelectorAll('.tool-dock-strip')).toHaveLength(1);
    await some.done();
  }
});
