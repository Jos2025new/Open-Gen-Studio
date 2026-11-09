// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportPanel } from '../src/components/designer/ExportPanel';
import { createDoc, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { hasVisibleContent, isNearUniform, parseColor } from '../src/engine/design/exportContrast';
import { DEFAULT_EXPORT } from '../src/engine/design/exportSettings';
import { setSettings, useStore } from '../src/store/store';

const preview = vi.hoisted(() => ({ promise: new Promise<Blob>(() => undefined), sample: null as Uint8ClampedArray | null }));
vi.mock('../src/lib/idb', async (original) => ({ ...await original<typeof import('../src/lib/idb')>(), stateDb: { get: async () => undefined, set: async () => undefined } }));
vi.mock('../src/engine/design/exportDesign', async (original) => ({
  ...await original<typeof import('../src/engine/design/exportDesign')>(),
  prepareDesignPreview: () => preview.promise,
}));
vi.mock('../src/engine/design/exportContrast', async (original) => ({
  ...await original<typeof import('../src/engine/design/exportContrast')>(),
  samplePreview: async () => preview.sample,
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

  it('shows one File name with the real result names, and the prefix only in the gear unless set', () => {
    mount();
    const line = () => document.querySelector('[data-testid="export-names"]')?.textContent;
    expect(line()).toBe('→ Doc.png');
    expect(text()).toContain('File name');
    expect(text()).not.toContain('Prefix');
    gear();
    expect(text()).toContain('Prefix (added before every file name)');
    act(() => root.unmount());
    document.body.innerHTML = '';
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    mount({ ...base, lastExport: { settings: { ...DEFAULT_EXPORT, prefix: 'app_', outputs: [{ scale: 1, suffix: '', format: 'png' }, { scale: 2, suffix: '@2x', format: 'png' }] } } });
    expect(line()).toBe('→ app_Doc.png, app_Doc@2x.png (ZIP)');
    expect([...document.querySelectorAll('label')].some((l) => l.textContent?.startsWith('Prefix') && !l.textContent.includes('added'))).toBe(true);
  });

  it('shows a labelled, readable background', () => {
    mount({ ...base, background: '#ffffff' });
    expect(document.querySelector('.design-export-bg')?.textContent).toContain('Background');
    expect(document.querySelector('.design-export-bgvalue')?.textContent).toBe('White');
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
      preview.promise = Promise.resolve(new Blob(['x']));
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
