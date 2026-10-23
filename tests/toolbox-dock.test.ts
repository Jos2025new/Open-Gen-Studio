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
  useStore.setState({ ui: { ...initialUi, tool: 'move', selectShape: 'rect' } });
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

  it('shows the same toolbox in both paint modes, and a tool key never changes the mode', async () => {
    const ids = () => [...host.querySelectorAll('[aria-label="Tools"] > span > button')].map((b) => b.getAttribute('aria-label'));
    const drawing = ids();
    await act(async () => { setUi({ tool: 'rect' }); root.render(createElement(ToolDock, { sessionId: 'test', doc: { ...doc, paintMode: 'design' } })); });
    expect(ids()).toEqual(drawing);
    expect(host.querySelector('[aria-label="Shapes"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(doc.paintMode).toBe('drawing');
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

  it('keeps the Drawing/Design switch out of the toolbox and inside the brush card', async () => {
    expect(host.querySelector('.tool-dock-family .paint-mode')).toBeNull();
    await click('Brush'); await click('Pencil');
    expect(host.querySelector('[aria-label="Pencil settings"]')).toBeTruthy();
    expect(host.querySelectorAll('.tool-dock-card .paint-mode').length).toBe(1);
  });

  it('opens Layout in design mode: Sizes is real, so the family is not Soon', async () => {
    await act(async () => root.render(createElement(ToolDock, { sessionId: 'test', doc: { ...doc, paintMode: 'design' } })));
    const layout = [...host.querySelectorAll('.tool-dock-family button')].find((b) => b.getAttribute('aria-label')?.startsWith('Layout'))!;
    expect(layout.getAttribute('aria-label')).toBe('Layout');
    await act(async () => (layout as HTMLButtonElement).click());
    expect(host.querySelector('[aria-label="Layout variants"] button[aria-label="Sizes"]')).toBeTruthy();
    await click('Sizes');
    const card = host.querySelector('[aria-label="Sizes settings"]')!;
    expect([...card.querySelectorAll('input[type=number]')].map((i) => (i as HTMLInputElement).value)).toEqual(['100', '100']);
    expect(card.querySelector('[aria-label="Anchor"]')).toBeTruthy();
    expect([...card.querySelectorAll('button')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['Trim to content', 'Apply']));
  });

  it('lays the brush card out as the mockup: brush on the left, every other control in tabs that keep the height', async () => {
    await click('Brush'); await click('Pencil');
    const card = host.querySelector('.brush-card')!;
    expect(card.querySelector('.brush-card-head .paint-mode')).toBeTruthy();
    expect([...card.querySelectorAll('.brush-card-tabs .segmented button')].map((b) => b.textContent)).toEqual(['Tip', 'Stroke', 'Pressure', 'Blend']);
    const labels = [...card.querySelectorAll('.brush-card-pane .opt-label')].map((l) => l.textContent);
    for (const label of ['Tip', 'Hardness', 'Mirror', 'Taper start', 'Taper end', 'Stabilize', 'Smoothing', 'Simulate pressure', 'Pressure → size', 'Min size', 'Pressure → density', 'Min density', 'Blend', 'Keep opacity']) expect(labels, label).toContain(label);
    expect(labels).not.toContain('Advanced settings');
    const panes = [...card.querySelectorAll<HTMLElement>('.brush-card-pane')];
    expect(panes.filter((p) => !p.hasAttribute('inert')).length).toBe(1);
  });
});
