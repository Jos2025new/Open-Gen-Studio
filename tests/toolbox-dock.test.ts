// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { ToolDock } from '../src/components/designer/ToolDock';
import { createDoc } from '../src/engine/design/doc';
import { setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialUi = useStore.getState().ui;
let root: Root;
let host: HTMLDivElement;
let doc: ReturnType<typeof createDoc>;

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  useStore.setState({ ui: { ...initialUi, tool: 'fill', selectShape: 'rect' } });
  doc = { ...createDoc('Dock', 100, 100), paintMode: 'drawing' };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(ToolDock, { sessionId: 'test', doc })));
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  useStore.setState({ ui: initialUi }); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function click(label: string) {
  const button = [...host.querySelectorAll('button')].filter((item) => item.getAttribute('aria-label') === label).at(-1);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}

describe('ToolDock real interaction', () => {
  it('opens variants, full settings, folds, closes and reopens the active family', async () => {
    await click('Brush');
    expect(host.querySelector('[aria-label="Brush variants"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Brush settings"]')).toBeNull();
    let bubbled = false;
    const onKey = () => { bubbled = true; };
    document.body.addEventListener('keydown', onKey);
    const brushVariant = host.querySelector('[aria-label="Brush variants"] button[aria-label="Brush"]')!;
    await act(async () => brushVariant.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Pencil');
    expect(bubbled).toBe(false);
    document.body.removeEventListener('keydown', onKey);
    await click('Pencil');
    expect(useStore.getState().ui.tool).toBe('brush');
    expect(useStore.getState().ui.brush.hardness).toBe(1);
    expect(['Brush', 'Pencil', 'Airbrush'].filter((label) => host.querySelector(`[aria-label="Brush variants"] button[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'true')).toEqual(['Pencil']);
    expect(host.querySelector('[aria-label="Pencil settings"]')).toBeTruthy();
    await click('Hide tool settings');
    expect(host.querySelector('[aria-label="Pencil settings"]')).toBeNull();
    await click('Brush');
    expect(host.querySelector('[aria-label="Brush variants"]')).toBeNull();
    await click('Brush');
    expect(host.querySelector('[aria-label="Brush variants"]')).toBeTruthy();
  });

  it('selects actual shape tools from the variant row', async () => {
    doc = { ...doc, paintMode: 'design' };
    await act(async () => root.render(createElement(ToolDock, { sessionId: 'test', doc })));
    await click('Shapes');
    await click('Rectangle');
    expect(useStore.getState().ui.tool).toBe('rect');
    await click('Shapes');
    await click('Shapes');
    await click('Ellipse');
    expect(useStore.getState().ui.tool).toBe('ellipse');
  });

  it('shows a visitor family for an external tool and returns to the document mode without changing it', async () => {
    doc = { ...doc, paintMode: 'drawing' };
    await act(async () => { setUi({ tool: 'rect' }); root.render(createElement(ToolDock, { sessionId: 'test', doc })); });
    expect(host.querySelector('[aria-label="drawing tools"] [aria-label="Shapes · other mode"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Paint mode"]')).toBeTruthy();
    await click('Brush');
    expect(useStore.getState().ui.tool).toBe('brush');
    expect(doc.paintMode).toBe('drawing');
    expect(host.querySelector('[aria-label="drawing tools"] [aria-label="Shapes · other mode"]')).toBeNull();
  });

  it('uses Escape on real key events to descend one depth at a time', async () => {
    await click('Brush');
    await click('Show tool settings');
    const grip = host.querySelector('[aria-label="Resize tool settings"]')!;
    await click('Pencil');
    await act(async () => grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[aria-label="Pencil settings"]')).toBeNull();
    await act(async () => host.querySelector('[aria-label="Brush variants"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[aria-label="Brush variants"]')).toBeNull();
  });

  it('keeps Settings as a disabled, explained Soon item without showing unrelated settings', async () => {
    const settings = host.querySelector('[aria-label^="Settings · Soon:"]') as HTMLButtonElement;
    expect(settings?.getAttribute('aria-disabled')).toBe('true');
    expect(settings?.title).toContain('planned');
    await act(async () => settings.click());
    expect(host.querySelector('.tool-dock-card')).toBeNull();
  });
});
