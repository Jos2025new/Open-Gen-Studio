// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportPanel } from '../src/components/designer/ExportPanel';
import { createDoc, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { hasVisibleContent, isNearUniform, parseColor } from '../src/engine/design/exportContrast';
import { BUILTIN_EXPORTS, DEFAULT_EXPORT } from '../src/engine/design/exportSettings';
import { setSettings, useStore } from '../src/store/store';

const preview = vi.hoisted(() => ({ promise: new Promise<HTMLCanvasElement>(() => undefined), sample: null as Uint8ClampedArray | null }));
vi.mock('../src/lib/idb', async (original) => ({ ...await original<typeof import('../src/lib/idb')>(), stateDb: { get: async () => undefined, set: async () => undefined } }));
vi.mock('../src/engine/design/exportDesign', async (original) => ({
  ...await original<typeof import('../src/engine/design/exportDesign')>(),
  prepareDesignPreview: () => preview.promise,
}));
vi.mock('../src/engine/design/exportContrast', async (original) => ({
  ...await original<typeof import('../src/engine/design/exportContrast')>(),
  samplePreview: () => preview.sample,
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
/** A field menu by its name (InlineSelect / ExportMenu), then the choice. */
const field = (label: string) => [...document.body.querySelectorAll('button.opt-pick')].find((b) => b.querySelector('.opt-label')?.textContent === label || b.getAttribute('aria-label')?.startsWith(`${label} · `));
const choose = (label: string, option: string) => { click(field(label)); click([...document.body.querySelectorAll('.menu-item')].find((e) => e.textContent?.startsWith(option))); };
const nums = () => [...document.querySelectorAll<HTMLInputElement>('.design-export-size .opt-num')];

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; setSettings({ designExportPresets: [], designExportPinned: [] }); });

describe('export panel', () => {
  it('stacks menus opened inside a popover above it', () => {
    act(() => { root.render(createElement('div', { className: 'popover', style: { zIndex: 100 } }, createElement(ExportPanel, { sessionId: 's', doc: base }))); });
    click(field('Format'));
    const menus = [...document.body.querySelectorAll<HTMLElement>('body > .popover')];
    expect(menus).toHaveLength(1);
    expect(Number(menus[0].style.zIndex)).toBeGreaterThan(100);
  });

  it('uses the app controls: no native select, format menu with purposes', () => {
    mount();
    expect(document.querySelectorAll('select').length).toBe(0);
    expect(document.querySelectorAll('.design-export .opt').length).toBeGreaterThan(5);
    click(field('Format'));
    for (const note of ['Best for sharing', 'Images and complex illustrations', 'Smaller files for websites', 'Scalable, for web and logos', 'Documents and printing']) expect(text()).toContain(note);
    expect(document.querySelectorAll('select').length).toBe(0);
  });

  it('switches the preset label to Custom when a setting differs, and keeps a stable preview box', () => {
    mount({ ...base, lastExport: { settings: { ...DEFAULT_EXPORT, format: 'webp', quality: 80, preset: 'web' } } });
    const label = () => document.querySelector('button.opt-pick')!.textContent;
    expect(label()).toContain('Lightweight web');
    choose('Format', 'PNG');
    expect(label()).toContain('Lightweight web (edited)');
    expect(document.querySelector('.design-export-frame')).not.toBeNull();
    expect(document.querySelector('.design-export-footer .design-export-buttons')).not.toBeNull();
  });

  it('links width, height and DPI', () => {
    mount();
    const [w, h, dpi] = nums();
    expect([w.value, h.value, dpi.value]).toEqual(['120', '80', '96']);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(dpi, '192');
      dpi.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const [w2, h2] = nums();
    expect([w2.value, h2.value, dpi.value, document.querySelector('[role=alert]')?.textContent]).toEqual(['240', '160', '192', undefined]);
  });

  it('chooses the area with the app tabs', () => {
    mount();
    const tabs = [...document.querySelectorAll('.design-export-tabs .segmented button')];
    expect(tabs.map((b) => b.textContent)).toEqual(['Canvas', 'Drawing', 'Selection', 'Layer']);
    click(tabs[1]);
    expect(document.querySelector('.design-export-tabs .is-active')?.textContent).toBe('Drawing');
    expect((tabs[2] as HTMLButtonElement).disabled).toBe(true);
  });

  it('says edited for a changed preset, and Custom only when none applies', () => {
    mount({ ...base, lastExport: { settings: { ...DEFAULT_EXPORT, format: 'png', base: 'home-print' } } });
    expect(document.querySelector('button.opt-pick')!.textContent).toContain('Print at home (edited)');
    act(() => root.unmount());
    root = createRoot(host);
    mount();
    expect(document.querySelector('button.opt-pick')!.textContent).toContain('Custom');
  });

  it('shows one File name with the real result names, and the prefix only in the gear unless set', () => {
    mount();
    const line = () => document.querySelector('[data-testid="export-names"]')?.textContent;
    expect(line()).toBe('Doc.png');
    expect(field('Name')).toBeUndefined();
    expect(document.querySelector('.design-export-bar .opt-text')?.textContent).toContain('Name');
    expect(text()).not.toContain('Prefix');
    gear();
    expect(text()).toContain('Prefix');
    act(() => root.unmount());
    document.body.innerHTML = '';
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    mount({ ...base, lastExport: { settings: { ...DEFAULT_EXPORT, prefix: 'app_', outputs: [{ scale: 1, suffix: '', format: 'png' }, { scale: 2, suffix: '@2x', format: 'png' }] } } });
    expect(line()).toBe('app_Doc.png, app_Doc@2x.png · ZIP');
    expect(document.querySelector('.design-export-scroll')?.textContent).toContain('Prefix');
  });

  it('shows Quality in the main panel for JPG only, and pins gear options to the main panel', () => {
    mount();
    expect(field('Quality')).toBeUndefined();
    choose('Format', 'JPG');
    expect(field('Quality')?.textContent).toContain('High');
    choose('Format', 'SVG');
    expect(field('Quality')).toBeUndefined();
    gear();
    expect(document.querySelector('.design-export')?.textContent).not.toContain('Minify');
    click(document.querySelector('[aria-label="Pin Minify"]'));
    expect(useStore.getState().settings.designExportPinned).toEqual(['minify']);
    expect(document.querySelector('.design-export')?.textContent).toContain('Minify');
    expect(document.querySelector('[aria-label="Unpin Minify"]')).not.toBeNull();
  });

  it('shows paper, bleed and marks in the main panel only for Print shop, and Prefix for several outputs', () => {
    mount();
    const main = () => document.querySelector('.design-export')!.textContent!;
    expect(main()).not.toContain('Orientation');
    expect(main()).not.toContain('Bleed');
    act(() => root.unmount());
    root = createRoot(host);
    mount({ ...base, lastExport: { settings: BUILTIN_EXPORTS.find((p) => p.id === 'print-shop')!.settings } });
    for (const field of ['Orientation', 'Bleed', 'Crop marks']) expect(main()).toContain(field);
    expect(main()).not.toContain('Prefix');
    act(() => root.unmount());
    root = createRoot(host);
    mount({ ...base, lastExport: { settings: BUILTIN_EXPORTS.find((p) => p.id === 'ios')!.settings } });
    expect(main()).toContain('Prefix');
  });

  it('shows a labelled, readable background', () => {
    mount({ ...base, background: '#ffffff' });
    expect(document.querySelector('.design-export-facts .opt-color')?.textContent).toBe('Background#FFFFFF');
  });

  it('judges the rendered preview: a white raster layer on a white page is flagged', async () => {
    const white = { id: 'r', name: 'Paint', type: 'raster', visible: true, x: 0, y: 0, width: 100, height: 60, opacity: 1, blend: 'normal' } as never;
    const doc = { ...base, background: '#ffffff', layers: [white] };
    expect(hasVisibleContent(doc)).toBe(true);
    const white64 = new Uint8ClampedArray(64 * 64 * 4).fill(255);
    expect(isNearUniform(white64, parseColor('#ffffff'))).toBe(true);
    const marked = white64.slice();
    for (let i = 0; i < 4 * 64 * 4; i += 4) marked.set([0, 0, 0, 255], i);
    expect(isNearUniform(marked, parseColor('#ffffff'))).toBe(false);
    expect(isNearUniform(new Uint8ClampedArray(64 * 64 * 4), null)).toBe(true);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:p', revokeObjectURL: () => undefined });
    vi.useFakeTimers();
    try {
      preview.promise = Promise.resolve(document.createElement('canvas'));
      preview.sample = white64;
      mount(doc);
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(document.querySelector('[role="note"]')?.textContent).toContain('white on a white page');
      preview.sample = marked;
      act(() => root.unmount());
      root = createRoot(host);
      mount(doc);
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(document.querySelector('[role="note"]')).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      preview.promise = new Promise(() => undefined);
      preview.sample = null;
    }
  });

  it('draws no field of its own: the panel CSS never restyles the shared .opt fields', () => {
    const css = readFileSync('src/styles/designer-export.css', 'utf8');
    expect(css).not.toMatch(/\.opt\s*\{/);
    expect(css).not.toMatch(/!important/);
    expect(css.length).toBeLessThan(5000);
  });

  it('shows the scale unit in rows', () => {
    mount();
    click(byText('+ Add scale'));
    expect(field('Scale of file 2')?.textContent).toContain('2×');
  });

  it('offers the text choice only for SVG or PDF of a document with text', () => {
    const toSvg = () => choose('Format', 'SVG');
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
    expect(field('Text')?.textContent).toContain('Embed fonts');
    click(field('Text'));
    expect(text()).toContain('Convert to paths');
  });

  it('shows only the fields that apply', () => {
    mount();
    expect(text()).toContain('Transparent');
    expect(field('Quality')).toBeUndefined();
    choose('Format', 'JPG');
    expect(field('Quality')).toBeDefined();
    expect(text()).not.toContain('Transparent');
    choose('Format', 'PDF');
    gear();
    choose('PDF page', 'Paper');
    expect(nums()).toHaveLength(0);
    expect(text()).toContain('Orientation');
    expect(field('PDF page')?.textContent).toContain('Paper');
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
    choose('Format', 'PDF');
    gear();
    choose('PDF page', 'Paper');
    expect(byText('Add scale')).toBeUndefined();
    expect(document.querySelectorAll('select').length).toBe(0);
  });

  it('deletes an own preset only after an inline confirmation', () => {
    setSettings({ designExportPresets: [{ id: 'mine', name: 'Mine', settings: DEFAULT_EXPORT }] });
    mount({ ...base, lastExport: { settings: { ...DEFAULT_EXPORT, preset: 'mine' } } });
    gear();
    click(byText('Delete preset'));
    expect(text()).toContain('Delete “Mine”?');
    click(byText('Cancel'));
    expect(useStore.getState().settings.designExportPresets).toHaveLength(1);
    click(byText('Delete preset'));
    click([...document.querySelectorAll('button')].filter((b) => b.textContent === 'Delete preset').at(-1));
    expect(useStore.getState().settings.designExportPresets).toHaveLength(0);
  });
});
