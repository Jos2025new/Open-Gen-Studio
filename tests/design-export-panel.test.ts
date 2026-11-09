// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportPanel } from '../src/components/designer/ExportPanel';
import { createDoc, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { lowContrastNotice } from '../src/engine/design/exportContrast';
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
const gear = () => { if (!document.querySelector('.design-export-pop')) click(document.querySelector('[aria-label="Format options"]')); };
const byText = (label: string, selector = 'button') => [...document.body.querySelectorAll(selector)].find((e) => e.textContent?.includes(label));

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; setSettings({ designExportPresets: [] }); });

describe('export panel', () => {
  it('stacks menus opened inside a popover above it', () => {
    act(() => { root.render(createElement('div', { className: 'popover', style: { zIndex: 100 } }, createElement(ExportPanel, { sessionId: 's', doc: base }))); });
    click(byText('Format'));
    const menus = [...document.body.querySelectorAll<HTMLElement>('body > .popover')];
    expect(menus).toHaveLength(1);
    expect(Number(menus[0].style.zIndex)).toBeGreaterThan(100);
  });

  it('uses the app controls: no native select, format menu with purposes', () => {
    mount();
    expect(document.querySelectorAll('select').length).toBe(0);
    click(byText('Format'));
    for (const note of ['Best for sharing', 'Best for images and complex illustrations', 'Smaller files for websites', 'Scalable, for web and logos', 'Documents and printing']) expect(text()).toContain(note);
    expect(document.querySelectorAll('select').length).toBe(0);
  });

  it('switches the preset label to Custom when a setting differs, and keeps a stable preview box', () => {
    mount({ ...base, lastExport: { settings: { ...DEFAULT_EXPORT, format: 'webp', quality: 80, preset: 'web' } } });
    const label = () => document.querySelector('button.opt-pick')!.textContent;
    expect(label()).toContain('Lightweight web');
    click(byText('Format'));
    click(byText('PNG', '.menu-item'));
    expect(label()).toContain('Lightweight web (edited)');
    expect(document.querySelector('.design-export-frame')).not.toBeNull();
    expect(document.querySelector('.design-export-footer .design-export-buttons')).not.toBeNull();
  });

  it('links width, height and DPI', () => {
    mount();
    const [w, h, dpi] = [...document.querySelectorAll<HTMLInputElement>('.design-export-size input')];
    expect([w.value, h.value, dpi.value]).toEqual(['120', '80', '96']);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(dpi, '192');
      dpi.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const [w2, h2] = [...document.querySelectorAll<HTMLInputElement>('.design-export-size input')];
    expect([w2.value, h2.value, dpi.value, document.querySelector('[role=alert]')?.textContent]).toEqual(['240', '160', '192', undefined]);
  });

  it('groups the area as one row with a Selection sub-choice', () => {
    mount();
    const row = document.querySelector('[aria-label="Export area"]')!;
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Canvas', 'Drawing', 'Selection', 'Layer']);
    click(byText('Selection', '[role="radio"]'));
    expect(text()).toContain('Selection of');
  });

  it('says edited for a changed preset, and Custom only when none applies', () => {
    mount({ ...base, lastExport: { settings: { ...DEFAULT_EXPORT, format: 'png', base: 'home-print' } } });
    expect(document.querySelector('button.opt-pick')!.textContent).toContain('Print at home (edited)');
    act(() => root.unmount());
    root = createRoot(host);
    mount();
    expect(document.querySelector('button.opt-pick')!.textContent).toContain('Custom');
  });

  it('shows a readable background and warns about white art on a white page', () => {
    const white = newVectorLayer('W', [{ type: 'rect', x: 1, y: 1, w: 9, h: 9, radius: 0, fill: '#ffffff', stroke: null, strokeWidth: 0 }]);
    mount({ ...base, background: '#ffffff', layers: [white] });
    expect(text()).toContain('White');
    expect(document.querySelector('[role="note"]')?.textContent).toContain('white on a white page');
    expect(lowContrastNotice({ ...base, layers: [layer] }, '#ffffff')).toBeUndefined();
    expect(lowContrastNotice({ ...base, layers: [white] }, null)).toBeUndefined();
  });

  it('keeps segmented buttons in equal flexible columns, never fixed narrower than their text', () => {
    const css = readFileSync('src/styles/designer-export.css', 'utf8');
    const rule = /\.design-export-seg-row button \{([^}]*)\}/.exec(css)![1];
    expect(rule).toMatch(/flex:\s*1 1 0/);
    expect(rule).toMatch(/min-inline-size:\s*0/);
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).not.toMatch(/(^|[;\s])(inline-)?(size|width):/);
  });

  it('shows the scale unit in rows', () => {
    mount();
    click(byText('+ Add scale'));
    expect(document.querySelector('.design-export-scale')?.textContent).toContain('×');
  });

  it('offers the text choice only for SVG or PDF of a document with text', () => {
    const toSvg = () => { click(byText('Format')); click(byText('SVG', '.menu-item')); };
    mount();
    toSvg();
    gear();
    expect(text()).not.toContain('Convert to paths');
    act(() => root.unmount());
    document.body.innerHTML = '';
    host = document.createElement('div'); document.body.append(host);
    root = createRoot(host);
    mount({ ...base, layers: [layer, newTextLayer('T', 'Hi', { x: 1, y: 1, width: 10 })] as never });
    gear();
    expect(text()).not.toContain('Convert to paths');
    toSvg();
    gear();
    expect(text()).toContain('Embed fonts');
    expect(text()).toContain('Convert to paths');
  });

  it('shows only the fields that apply', () => {
    mount();
    expect(text()).toContain('Transparent');
    gear();
    expect(text()).not.toContain('Limit size');
    click(byText('Format'));
    click(byText('JPG', '.menu-item'));
    gear();
    expect(text()).toContain('Limit size');
    expect(text()).not.toContain('Transparent');
    click(byText('Format'));
    click(byText('PDF', '.menu-item'));
    gear();
    click(byText('Paper', '[role="radio"]'));
    expect(text()).not.toContain('Width (px)');
    expect(text()).toContain('Orientation');
    expect(text()).toContain('Print shop');
    expect(text()).toContain('Raster resolution');
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
    click(byText('Format'));
    click(byText('PDF', '.menu-item'));
    gear();
    click(byText('Paper', '[role="radio"]'));
    expect(byText('Add scale')).toBeUndefined();
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
