// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportPanel } from '../src/components/designer/ExportPanel';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { DEFAULT_EXPORT } from '../src/engine/design/exportSettings';
import { setSettings, useStore } from '../src/store/store';

vi.mock('../src/lib/idb', async (original) => ({ ...await original<typeof import('../src/lib/idb')>(), stateDb: { get: async () => undefined, set: async () => undefined } }));
vi.mock('../src/engine/design/exportDesign', async (original) => ({
  ...await original<typeof import('../src/engine/design/exportDesign')>(),
  prepareDesignPreview: () => new Promise(() => undefined),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const layer = newVectorLayer('Rect', [{ type: 'rect', x: 10, y: 8, w: 20, h: 10, radius: 0, fill: '#ff0000', stroke: null, strokeWidth: 0 }]);
const base = { ...createDoc('Doc', 120, 80), layers: [layer], activeLayerId: layer.id };
let host: HTMLDivElement, root: Root;

const mount = (doc = base) => act(() => { root.render(createElement(ExportPanel, { sessionId: 's', doc })); });
const text = () => document.body.textContent ?? '';
const click = (el: Element | null | undefined) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const byText = (label: string, selector = 'button') => [...document.body.querySelectorAll(selector)].find((e) => e.textContent?.includes(label));

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; setSettings({ designExportPresets: [] }); });

describe('export panel', () => {
  it('uses the app controls: no native select, format menu with purposes', () => {
    mount();
    expect(document.querySelectorAll('select').length).toBe(0);
    click(byText('Format'));
    for (const note of ['Best for sharing', 'Best for images and complex illustrations', 'Smaller files for websites', 'Scalable, for web and logos', 'Documents and printing']) expect(text()).toContain(note);
    expect(document.querySelectorAll('select').length).toBe(0);
  });

  it('shows only the fields that apply', () => {
    mount();
    expect(text()).toContain('Transparent background');
    expect(text()).not.toContain('Limit size');
    click(byText('Format'));
    click(byText('JPG', '.menu-item'));
    expect(text()).toContain('Limit size');
    expect(text()).not.toContain('Transparent background');
    click(byText('Format'));
    click(byText('PDF', '.menu-item'));
    click(byText('Paper', '[role="radio"]'));
    expect(text()).not.toContain('Scale');
    expect(text()).toContain('Orientation');
    expect(text()).toContain('Print shop');
  });

  it('adds and removes scale rows and counts the files', () => {
    mount();
    click(byText('+ Add scale'));
    expect(text()).toContain('2 files');
    click(byText('Add scale'));
    expect(text()).toContain('3 files');
    click(document.querySelector('[aria-label="Remove file 3"]'));
    click(document.querySelector('[aria-label="Remove file 2"]'));
    expect(text()).not.toContain('files ·');
    expect(document.querySelectorAll('select').length).toBe(0);
  });

  it('deletes an own preset only after an inline confirmation', () => {
    setSettings({ designExportPresets: [{ id: 'mine', name: 'Mine', settings: DEFAULT_EXPORT }] });
    mount({ ...base, lastExport: { settings: { ...DEFAULT_EXPORT, preset: 'mine' } } });
    click(byText('Delete preset'));
    expect(text()).toContain('Delete the preset');
    click(byText('Cancel'));
    expect(useStore.getState().settings.designExportPresets).toHaveLength(1);
    click(byText('Delete preset'));
    click([...document.querySelectorAll('button')].filter((b) => b.textContent === 'Delete preset').at(-1));
    expect(useStore.getState().settings.designExportPresets).toHaveLength(0);
  });
});
