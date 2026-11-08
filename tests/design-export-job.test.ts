// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { svg2pdf } from 'svg2pdf.js';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDoc, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { writeFilesToFolder, type FolderHandle } from '../src/engine/design/exportFolder';
import { currentExportTarget, deliverDesignExport, resolveExportTarget } from '../src/engine/design/exportDesign';
import { exportDownloadFile, exportGeometry, exportPlan, exportPreview, validateExport } from '../src/engine/design/exportJob';
import { BUILTIN_EXPORTS, DEFAULT_EXPORT, row, type ExportSettings } from '../src/engine/design/exportSettings';
import { setSelection } from '../src/engine/design/pixelSelection';
import type { SvgDeps } from '../src/engine/design/export';

vi.mock('../src/lib/idb', async (original) => ({
  ...await original<typeof import('../src/lib/idb')>(),
  stateDb: { get: async () => undefined, set: async () => undefined },
}));
vi.mock('svg2pdf.js', async () => {
  // Use the real browser build. The package's Node entry points at a UMD script without an ESM export.
  // @ts-expect-error The browser bundle has no separate declaration file.
  const browser = await import('../node_modules/svg2pdf.js/dist/svg2pdf.es.js');
  return { svg2pdf: vi.fn(browser.svg2pdf) };
});

const layout: SvgDeps = { rasterHref: async () => null, layout: () => ({ lines: ['Hello'], width: 50, lineHeightPx: 14 }), ascent: () => 11 };
const rect = newVectorLayer('Rectangle', [{ type: 'rect', x: 10, y: 8, w: 20, h: 10, radius: 0, fill: '#ff0000', stroke: null, strokeWidth: 0 }]);
const design = { ...createDoc('My design', 120, 80), layers: [rect], activeLayerId: rect.id };
const encodes: { width: number; height: number; mime: string; quality?: number }[] = [];
const fillColors: string[] = [];
let allowWebp: boolean;
let failPngWidth: number | undefined;
const signatures: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
};

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value(this: SVGElement) { return { x: 0, y: 0, width: (this.textContent?.length ?? 0) * 8, height: 14 }; },
  });
  encodes.length = 0;
  fillColors.length = 0;
  allowWebp = true;
  failPngWidth = undefined;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const ctx = { canvas: this, fillStyle: '', getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      fillRect() { fillColors.push(this.fillStyle); }, measureText: (text: string) => ({ width: text.length * 8 }) };
    return new Proxy(ctx, { get: (object, key) => key in object ? object[key as keyof typeof object] : () => undefined }) as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, mime = 'image/png', quality) {
    encodes.push({ width: this.width, height: this.height, mime, quality });
    if (mime === 'image/png' && this.width === failPngWidth) { callback(null); return; }
    const actualMime = mime === 'image/webp' && !allowWebp ? 'image/png' : mime;
    const size = Math.round(2000 * (quality ?? 1)) + 100;
    const bytes = new Uint8Array(size);
    bytes.set(signatures[actualMime]);
    callback(new Blob([bytes], { type: actualMime }));
  });
});

afterEach(() => { Reflect.deleteProperty(SVGElement.prototype, 'getBBox'); setSelection(design.id, null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function settings(preset: string): ExportSettings {
  return BUILTIN_EXPORTS.find((p) => p.id === preset)!.settings;
}

describe('raster export pipeline (browser encoder double)', () => {
  it.each(['png', 'jpg', 'webp'] as const)('routes %s through the right encoder and keeps its bytes', async (format) => {
    const [file] = await exportPlan(design, { ...DEFAULT_EXPORT, format, size: 3 }, {}, layout);
    expect(encodes[0]).toMatchObject({ width: 360, height: 240, mime: file.mime });
    expect(Array.from(new Uint8Array(await file.bytes.arrayBuffer()).slice(0, signatures[file.mime].length))).toEqual(signatures[file.mime]);
    expect(fillColors.includes('#ffffff')).toBe(format === 'jpg');
  });

  it('encodes one small PNG with the export proportions even for 3× and print', async () => {
    const doc = { ...design, width: 2000, height: 1000 };
    const jpg = await exportPreview(doc, { ...DEFAULT_EXPORT, size: 3, format: 'jpg' }, {});
    expect(jpg.type).toBe('image/png');
    expect(encodes).toEqual([{ width: 512, height: 256, mime: 'image/png', quality: undefined }]);
    expect(fillColors).toContain('#ffffff');
    await exportPreview(doc, { ...settings('home-print'), pdf: { paper: 'letter', orientation: 'landscape' } }, {});
    expect(encodes.at(-1)).toMatchObject({ width: 512, height: 396, mime: 'image/png' });
    await exportPreview(doc, settings('brand'), {});
    expect(encodes.at(-1)).toMatchObject({ width: 512, height: 256, mime: 'image/png' });
    expect(encodes).toHaveLength(3);
  });

  it('supports explicit transparency and a solid background without editing the document', async () => {
    const blue = { ...design, background: '#0000ff' };
    await exportPlan(blue, { ...DEFAULT_EXPORT, background: null }, {}, layout);
    expect(fillColors).not.toContain('#0000ff');
    await exportPlan(blue, { ...DEFAULT_EXPORT, background: '#ffee00' }, {}, layout);
    expect(fillColors).toContain('#ffee00');
    expect(blue.background).toBe('#0000ff');
  });

  it('reduces quality in steps for a limit and rejects an impossible limit', async () => {
    const [file] = await exportPlan(design, { ...DEFAULT_EXPORT, format: 'jpg', maxKb: 1 }, {}, layout);
    expect(file.bytes.size).toBeLessThanOrEqual(1024);
    expect(encodes.map((x) => x.quality)).toEqual([1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4]);
    await expect(exportPlan(design, { ...DEFAULT_EXPORT, format: 'jpg', maxKb: 0.05 }, {}, layout)).rejects.toThrow('increase the limit');
    expect(encodes.at(-1)?.quality).toBe(0);
  });

  it('blocks oversized output before encoding', async () => {
    await expect(exportPlan(design, { ...DEFAULT_EXPORT, size: 'width', pixels: 8193 }, {}, layout)).rejects.toThrow('No file was created');
    expect(encodes).toHaveLength(0);
  });

  it('uses the chosen layer bounds or pixel selection bounds', async () => {
    await exportPlan(design, { ...DEFAULT_EXPORT, area: 'layer', size: 2 }, { layerId: rect.id }, layout);
    await exportPlan(design, { ...DEFAULT_EXPORT, area: 'selection', size: 3 }, { selection: { points: [[5, 6], [20, 6], [20, 16], [5, 16]] } }, layout);
    expect(encodes.map(({ width, height }) => [width, height])).toEqual([[40, 20], [45, 30]]);
  });
});

describe('presets and delivery', () => {
  it('sets the promised WhatsApp, Instagram, Web and Portfolio dimensions and formats', async () => {
    const cases = [
      ['whatsapp', 1600, 1067, 'image/jpeg', 0.85],
      ['instagram', 1080, 720, 'image/jpeg', 0.92],
      ['web', 120, 80, 'image/webp', 0.80],
      ['portfolio', 240, 160, 'image/png', undefined],
    ] as const;
    for (const [preset, width, height, mime, quality] of cases) {
      const files = await exportPlan(design, settings(preset), {}, layout);
      expect(files).toHaveLength(1);
      expect(encodes.at(-1)).toEqual({ width, height, mime, quality });
      expect(await exportDownloadFile(design.name, files)).toBe(files[0]);
    }
    const fit = { ...settings('instagram'), fitInstagram: true };
    expect(exportGeometry(design, fit, {})).toMatchObject({ width: 1080, height: 1350, offsetY: 315 });
    await exportPlan(design, fit, {}, layout);
    expect(fillColors).toContain('#ffffff');
  });

  it('uses JPG with a JPG extension only for the Web preset when WebP is unavailable', async () => {
    allowWebp = false;
    const [file] = await exportPlan(design, settings('web'), {}, layout);
    expect(file).toMatchObject({ name: 'My-design.jpg', mime: 'image/jpeg' });
    await expect(exportPlan(design, { ...DEFAULT_EXPORT, format: 'webp' }, {}, layout)).rejects.toThrow('cannot encode');
  });

  it('creates one ZIP with three distinct names and the same bytes as the prepared files', async () => {
    const files = await exportPlan(design, settings('brand'), {}, layout);
    expect(encodes.map(({ width, height }) => [width, height])).toEqual([[120, 80], [240, 160]]);
    const zip = await exportDownloadFile(design.name, files);
    expect(zip).toMatchObject({ name: 'My-design.zip', mime: 'application/zip' });
    const entries = unzipSync(new Uint8Array(await zip.bytes.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(['My-design.svg', 'My-design.png', 'My-design@2x.png']);
    for (const file of files) expect(entries[file.name]).toEqual(new Uint8Array(await file.bytes.arrayBuffer()));
    expect((await exportDownloadFile(design.name, [files[0], files[0]])).name).toBe('My-design.zip');
  });

  it('stops the bundle on a failed or cancelled output', async () => {
    failPngWidth = 240;
    await expect(exportPlan(design, settings('brand'), {}, layout).then((files) => exportDownloadFile(design.name, files))).rejects.toThrow('No file was created');
    const controller = new AbortController();
    encodes.length = 0;
    await expect(exportPlan(design, settings('brand'), {}, layout, controller.signal, (done) => {
      if (done === 1) controller.abort();
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(encodes).toHaveLength(0);
  });

  it('suggests unique download names within this app instance', async () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:download', revokeObjectURL: () => undefined });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const [file] = await exportPlan(design, { ...DEFAULT_EXPORT, size: 2 }, {}, layout, undefined, undefined, ' My / logo ');
    expect(deliverDesignExport(file)).toBe('My-logo@2x.png');
    expect(deliverDesignExport(file)).toBe('My-logo@2x-2.png');
    const filename = ' Pack / Brand ';
    const files = await exportPlan(design, settings('brand'), {}, layout, undefined, undefined, filename);
    const zip = await exportDownloadFile(filename, files);
    expect(zip.name).toBe('Pack-Brand.zip');
    expect(files.map((file) => file.name)).toEqual(['Pack-Brand.svg', 'Pack-Brand.png', 'Pack-Brand@2x.png']);
    expect(click).toHaveBeenCalledTimes(2);
  });
});

describe('vector exports and remembered targets', () => {
  it('creates parseable, scaled SVG and preserves editable geometry', async () => {
    const [file] = await exportPlan(design, { ...DEFAULT_EXPORT, format: 'svg', size: 2, area: 'layer' }, { layerId: rect.id }, layout);
    const svg = new DOMParser().parseFromString(await file.bytes.text(), 'image/svg+xml');
    expect(svg.querySelector('parsererror')).toBeNull();
    expect(svg.documentElement.getAttribute('viewBox')).toBe('10 8 20 10');
    expect(svg.documentElement.getAttribute('width')).toBe('40');
    expect(svg.querySelector('rect[fill="#ff0000"]')).not.toBeNull();
  });

  it('renders a PDF with a shape and text, and Print at home makes a portrait A4 page', async () => {
    const text = newTextLayer('Text', 'Hello', { x: 25, y: 30, width: 60 });
    const doc = { ...design, layers: [rect, text] };
    const [screen] = await exportPlan(doc, { ...DEFAULT_EXPORT, format: 'pdf' }, {}, layout);
    const [paper] = await exportPlan(doc, settings('home-print'), {}, layout);
    expect(screen.mime).toBe('application/pdf');
    const pdf = await screen.bytes.text();
    expect(pdf).toMatch(/^%PDF-/);
    expect(pdf).toContain('/MediaBox [0 0 90. 60.]');
    expect(pdf).toContain('(Hello) Tj');
    expect(pdf).toContain(' re');
    expect(pdf).toMatch(/%%EOF\s*$/);
    const paperPdf = await paper.bytes.text();
    const [, width, height] = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(paperPdf) ?? [];
    expect(Number(width)).toBeCloseTo(595.28);
    expect(Number(height)).toBeCloseTo(841.89);
    const [old] = await exportPlan(doc, { ...settings('home-print'), pdf: 'a4' }, {}, layout);
    expect((await old.bytes.text()).match(/\/MediaBox \[.*?\]/)?.[0]).toBe(paperPdf.match(/\/MediaBox \[.*?\]/)?.[0]);
  });

  it('exports Letter landscape at 279.4 × 215.9 mm', async () => {
    const [file] = await exportPlan(design, { ...settings('home-print'), pdf: { paper: 'letter', orientation: 'landscape' } }, {}, layout);
    const [, width, height] = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(await file.bytes.text()) ?? [];
    expect(Number(width) * 25.4 / 72).toBeCloseTo(279.4);
    expect(Number(height) * 25.4 / 72).toBeCloseTo(215.9);
  });

  it('logs converter failures without exposing the internal error', async () => {
    const internal = new Error('Internal SVG failure at private/path');
    vi.mocked(svg2pdf).mockRejectedValueOnce(internal);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(exportPlan(design, settings('home-print'), {}, layout)).rejects.toMatchObject({
      message: 'Could not prepare PDF, so try a smaller size or another format.',
    });
    expect(logged).toHaveBeenCalledWith('[Designer export]', internal);
  });

  it('checks the original target instead of substituting an active layer or new selection', () => {
    const layer = { settings: { ...DEFAULT_EXPORT, area: 'layer' as const }, target: 'deleted-layer' };
    expect(() => validateExport(design, layer.settings, resolveExportTarget(design, layer))).toThrow('layer is unavailable');
    const selection = { ...DEFAULT_EXPORT, area: 'selection' as const };
    setSelection(design.id, { points: [[5, 6], [20, 6], [20, 16]] });
    const remembered = { settings: selection, target: currentExportTarget(design, selection) };
    expect(resolveExportTarget(design, remembered).selection).toBeDefined();
    setSelection(design.id, { points: [[5, 6], [20, 6], [20, 30]] });
    expect(() => validateExport(design, selection, resolveExportTarget(design, remembered))).toThrow('select an area');
    expect(design.lastExport).toBeUndefined();
    expect(() => validateExport(design, DEFAULT_EXPORT, {})).not.toThrow();
  });
});

describe('rows, areas, options and print', () => {
  const names = async (preset: string) => (await exportPlan(design, settings(preset), {}, layout)).map((f) => f.name);
  const sizes = () => encodes.map(({ width, height }) => `${width}x${height}`);

  it('builds brand, iOS and Android files from rows', async () => {
    expect(await names('brand')).toEqual(['My-design.svg', 'My-design.png', 'My-design@2x.png']);
    expect(await names('ios')).toEqual(['My-design.png', 'My-design@2x.png', 'My-design@3x.png']);
    encodes.length = 0;
    expect(await names('android')).toEqual(['ldpi', 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].map((d) => `My-design-${d}.png`));
    expect(sizes()).toEqual(['90x60', '120x80', '180x120', '240x160', '360x240', '480x320']);
  });

  it('numbers repeated names instead of failing, and adds the prefix', async () => {
    const dup = { ...DEFAULT_EXPORT, prefix: 'app_', outputs: [row(1, 'png'), row(1, 'png'), row(1, 'png', '@x')] };
    expect((await exportPlan(design, dup, {}, layout)).map((f) => f.name)).toEqual(['app_My-design.png', 'app_My-design-2.png', 'app_My-design@x.png']);
  });

  it('exports selected objects (incl. stroke reach) and drawing-only bounds', () => {
    const second = newVectorLayer('Outlined', [{ type: 'rect', x: 60, y: 40, w: 10, h: 10, radius: 0, fill: null, stroke: '#000000', strokeWidth: 4 }]);
    const doc = { ...design, layers: [rect, second] };
    const only = exportGeometry(doc, { ...DEFAULT_EXPORT, area: 'objects' }, { objects: [{ layerId: second.id, ids: [second.shapes[0].id] }] });
    expect(only.box.x).toBeLessThan(59);
    expect(only.box.x).toBeGreaterThan(54);
    expect(only.box.w).toBeGreaterThanOrEqual(14);
    expect(only.doc.layers).toHaveLength(1);
    const both = exportGeometry(doc, { ...DEFAULT_EXPORT, area: 'objects' }, { objects: [{ layerId: second.id, ids: [second.shapes[0].id] }, { layerId: rect.id, ids: [rect.shapes[0].id] }] });
    expect(both.box.x).toBe(10);
    expect(both.box.x + both.box.w).toBeGreaterThanOrEqual(72);
    expect(() => exportGeometry(doc, { ...DEFAULT_EXPORT, area: 'objects' }, {})).toThrow('No picked objects');
    expect(exportGeometry(design, { ...DEFAULT_EXPORT, area: 'content' }, {})).toMatchObject({ width: 20, height: 10, box: { x: 10, y: 8, w: 20, h: 10 } });
  });

  it('rounds, minifies and drops the title in SVG', async () => {
    const odd = { ...design, layers: [newVectorLayer('Odd', [{ type: 'rect', x: 10.123456, y: 8, w: 20, h: 10, radius: 0, fill: '#ff0000', stroke: null, strokeWidth: 0 }])] };
    const svg = async (options: ExportSettings['svg']) => (await exportPlan(odd, { ...DEFAULT_EXPORT, format: 'svg', svg: options }, {}, layout))[0].bytes.text();
    expect(await svg({})).toContain('10.123');
    const small = await svg({ decimals: 1, minify: true, metadata: false });
    expect(small).toContain('x="10.1"');
    expect(small).not.toMatch(/\n|inkscape:|<title>/);
  });

  it('makes a print PDF of trim + bleed, with room for crop marks', async () => {
    const mm = async (print: ExportSettings['print']) => {
      const [file] = await exportPlan(design, { ...settings('print-shop'), print }, {}, layout);
      const [, w, h] = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(await file.bytes.text()) ?? [];
      return [Number(w) * 25.4 / 72, Number(h) * 25.4 / 72];
    };
    const [w, h] = await mm({ bleedMm: 3, marks: false });
    expect([w, h].map((v) => Math.round(v * 10) / 10)).toEqual([216, 303]);
    const [mw, mh] = await mm({ bleedMm: 3, marks: true });
    expect([mw, mh].map((v) => Math.round(v * 10) / 10)).toEqual([226, 313]);
  });

  it('writes into a chosen folder, optionally by format, without overwriting', async () => {
    const tree = new Map<string, string[]>();
    const handle = (path: string): FolderHandle => ({
      name: path || 'root',
      getDirectoryHandle: async (name) => handle(`${path}${name}/`),
      getFileHandle: async (name, options) => {
        const list = tree.get(path) ?? [];
        if (!list.includes(name)) { if (!options?.create) throw new Error('missing'); tree.set(path, [...list, name]); }
        return { createWritable: async () => ({ write: async () => undefined, close: async () => undefined }) };
      },
    });
    const files = await exportPlan(design, settings('brand'), {}, layout);
    expect(await writeFilesToFolder(handle(''), files, true)).toEqual(['svg/My-design.svg', 'png/My-design.png', 'png/My-design@2x.png']);
    expect(await writeFilesToFolder(handle(''), files.slice(1, 2), false)).toEqual(['My-design.png']);
    expect((await writeFilesToFolder(handle(''), files.slice(1, 2), true))[0]).toBe('png/My-design-2.png');
  });
});
