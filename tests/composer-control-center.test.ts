// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ComposerOptions } from '../src/components/composer/ComposerOptions';
import { ComposerStrip } from '../src/components/composer/ComposerStrip';
import { setComposer, setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const initialUi = useStore.getState().ui, initialComposer = useStore.getState().composer;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; useStore.setState({ ui: initialUi, composer: initialComposer }); vi.unstubAllGlobals(); });
const labels = (sel: string) => [...document.querySelectorAll(sel)].map((b) => b.textContent?.trim());
const byText = (sel: string, t: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((b) => b.textContent?.trim() === t)!;
function openCenter() {
  const onAdd = vi.fn();
  act(() => root.render(createElement(ComposerOptions, { label: 'Attach images', disabled: false, onAdd, onAsset: () => {} })));
  act(() => host.querySelector<HTMLElement>('[aria-label="Control center"]')!.click());
  return onAdd;
}

describe('the "+" control center', () => {
  it('has the sections, Agent as its own item below Create, and the three spaces', () => {
    openCenter();
    expect(labels('.control-center-nav button')).toEqual(['Attach', 'Sessions', 'Library', 'Tools', 'Create', 'Agent']);
    expect(labels('.control-center-spaces button')).toEqual(['Studio', 'Nodes', 'Designer']);
  });
  it('attaching still works, and hovering a section shows it without a click', () => {
    const onAdd = openCenter();
    act(() => byText('.control-center-pane button', 'Attach images').click());
    expect(onAdd).toHaveBeenCalled();
    act(() => host.querySelector<HTMLElement>('[aria-label="Control center"]')!.click());
    act(() => { byText('.control-center-nav button', 'Create').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(labels('.control-center-pane button')).toEqual(['Image', 'Video', 'Audio', '3D']);
  });
  it('Create and Agent change the mode; in Designer they bring the prompt back, and Designer returns to the tools', () => {
    act(() => setUi({ workspace: 'designer', designerDock: 'tools' }));
    openCenter();
    act(() => byText('.control-center-nav button', 'Agent').click());
    expect(useStore.getState().composer.mode).toBe('agent');
    expect(useStore.getState().ui.designerDock).toBe('prompt');
    act(() => host.querySelector<HTMLElement>('[aria-label="Control center"]')!.click());
    act(() => byText('.control-center-spaces button', 'Designer').click());
    expect(useStore.getState().ui.designerDock).toBe('tools');
  });
  it('a space button changes the workspace', () => {
    act(() => setUi({ workspace: 'chat' }));
    openCenter();
    act(() => byText('.control-center-spaces button', 'Nodes').click());
    expect(useStore.getState().ui.workspace).toBe('node');
  });
});

describe('the strip above the prompt', () => {
  it('Skills and Workflows are always visible in Agent, on the rail', () => {
    act(() => { setUi({ workspace: 'chat' }); setComposer({ mode: 'agent', skillId: null, workflowId: null }); });
    act(() => root.render(createElement(ComposerStrip)));
    const rail = host.querySelector('.composer-strip-rail')!.textContent ?? '';
    expect(rail).toContain('Skills');
    expect(rail).toContain('Workflows');
    expect(host.querySelector('.composer-strip-end')!.children.length).toBeGreaterThan(0);
  });
  it('without overflow it shows no arrows', () => {
    act(() => { setUi({ workspace: 'chat' }); setComposer({ mode: 'agent' }); });
    act(() => root.render(createElement(ComposerStrip)));
    expect(host.querySelector('.composer-strip-nudge')).toBeNull();
  });
});
