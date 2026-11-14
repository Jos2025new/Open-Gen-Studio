// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as resvg from '@resvg/resvg-wasm';
import type { DesignDoc, Layer, VectorLayer, VectorShape } from '../src/engine/types';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));
vi.mock('svg2pdf.js', async () => {
  // @ts-expect-error browser bundle
  const browser = await import('../node_modules/svg2pdf.js/dist/svg2pdf.es.js');
  return { svg2pdf: browser.svg2pdf };
});
import { docToSvg, svgToPdf, type SvgDeps } from '../src/engine/design/export';
import { newTextLayer } from '../src/engine/design/doc';
import { newFxLayer, newFxOp } from '../src/engine/fx/fxCommands';

/*
 * The PDF contract (docs/intercambio-svg.md → PDF): the PDF of a document looks like the document. Each case is
 * exported to PDF, the PDF is drawn by real PDF readers installed here (poppler's pdftoppm, and Ghostscript), and the
 * pixels are compared with the document's own SVG drawn by resvg. Edges differ by antialiasing between renderers, so
 * the measure is: at most 0.5 % of the pixels off by more than 32/255 in a channel, and a mean difference under 1.5
 * (2 % and 2.5 for Ghostscript and for pictures of effects, whose edges are drawn differently).
 * (Before pdfLook.ts: group opacity 3.75 %, blend 15–26 %, gradient alpha 51 %, masks 7–27 %, arrowheads gone.)
 */
const W = 200, H = 120;
const rect = (id: string, x: number, y: number, fill: string | null, extra: Partial<VectorShape> = {}): VectorShape => ({ id, type: 'rect', x, y, w: 60, h: 60, radius: 0, fill, stroke: null, strokeWidth: 0, ...extra } as VectorShape);
const vec = (id: string, shapes: VectorShape[], extra: Partial<VectorLayer> = {}): VectorLayer => ({ id, name: id, type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes, ...extra } as unknown as VectorLayer);
const docOf = (layers: Layer[], background: string | null = '#ffffff'): DesignDoc => ({ id: 'D', name: 'D', width: W, height: H, background, activeLayerId: layers[0].id, createdAt: 0, updatedAt: 0, layers } as unknown as DesignDoc);
const back = vec('Back', [rect('bk', 0, 0, '#ffcc00', { w: 120, h: 120 })]);
const stroke = { stroke: '#112233', strokeWidth: 8, join: 'miter', cap: 'butt' } as const;
const raster = (id: string) => ({ id, name: id, type: 'raster', visible: true, locked: false, opacity: 1, blend: 'normal', x: 20, y: 20, width: 80, height: 80, pxWidth: 80, pxHeight: 80, rev: 1 }) as unknown as Layer;
const line = (id: string, from: [number, number], to: [number, number], extra: Partial<VectorShape>): VectorShape => ({ id, type: 'line', x: from[0], y: from[1], w: to[0] - from[0], h: to[1] - from[1], radius: 0, fill: null, ...stroke, strokeWidth: 4, ...extra } as VectorShape);
const group = (look: object) => ({ objectGroups: [{ id: 'g', name: 'G', ...look }] }) as never;
const fx = (kind: 'filter' | 'effect', scope: 'below' | 'layer', op: Parameters<typeof newFxOp>[0], params?: Parameters<typeof newFxOp>[1]) => ({ ...newFxLayer(kind, { scope, ops: [newFxOp(op, params)] }), id: 'fx', name: 'FX' }) as Layer;

const dataUrl = (png: Uint8Array) => `data:image/png;base64,${btoa(Array.from(png, (b) => String.fromCharCode(b)).join(''))}`;
let png = '';
const notices: string[] = [];
const inter = new Uint8Array(readFileSync('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff'));
const plain: SvgDeps = { rasterHref: async () => png, layout: () => ({ lines: ['Hello', 'World'], width: 120, lineHeightPx: 34 }), ascent: () => 27, fontFile: async () => inter };
/** The app's own renderer needs a canvas; here the same part of the document is drawn from its SVG by resvg. */
const deps: SvgDeps = {
  ...plain, notice: (m) => notices.push(m),
  picture: async (part, box = { x: 0, y: 0, w: part.width, h: part.height }, scale = 2) =>
    dataUrl(new resvg.Resvg(await docToSvg(part, plain, { width: box.w, height: box.h, box }), { fitTo: { mode: 'zoom', value: scale } }).render().asPng()),
};

/** [the document, a document that must look the same when the reference renderer cannot draw the first]. */
const cases: Record<string, () => DesignDoc | [DesignDoc, DesignDoc]> = {
  plain: () => docOf([vec('A', [rect('a', 20, 20, '#ff0000', stroke), { ...rect('b', 100, 30, '#00aa00'), type: 'ellipse' } as VectorShape])]),
  'fill and stroke opacity': () => docOf([back, vec('A', [rect('a', 60, 30, '#ff0000', { ...stroke, fillOpacity: 0.4, strokeOpacity: 0.6 })])]),
  'layer opacity over overlapping shapes': () => docOf([back, vec('A', [rect('a', 60, 10, '#ff0000'), rect('b', 90, 40, '#0000ff')], { opacity: 0.5 })]),
  'group opacity': () => docOf([back, vec('A', [rect('a', 60, 10, '#ff0000', { groupId: 'g' }), rect('b', 90, 40, '#0000ff', { groupId: 'g' })], group({ opacity: 0.5 }))]),
  'layer blend': () => docOf([back, vec('A', [rect('a', 60, 30, '#00aaff')], { blend: 'multiply' })]),
  'group blend with opacity': () => docOf([back, vec('A', [rect('a', 60, 10, '#00aaff', { groupId: 'g' }), rect('b', 90, 40, '#ff00aa', { groupId: 'g' })], group({ blend: 'difference', opacity: 0.8 }))]),
  'group inside a faded, blended layer': () => docOf([back, vec('A', [rect('z', 40, 40, '#00ff00'), rect('a', 60, 10, '#ff0000', { groupId: 'g' }), rect('b', 90, 40, '#0000ff', { groupId: 'g' })], { opacity: 0.7, blend: 'screen', ...(group({ opacity: 0.5, blend: 'multiply' }) as object) })]),
  gradient: () => docOf([vec('A', [rect('a', 20, 20, null, { w: 160, h: 80, fillGradient: { kind: 'linear', x1: 20, y1: 20, x2: 180, y2: 100, stops: [{ offset: 0, color: '#ff0000', alpha: 1 }, { offset: 1, color: '#0000ff', alpha: 1 }] } })])]),
  'gradient with alpha': () => docOf([back, vec('A', [rect('a', 20, 20, null, { w: 160, h: 80, fillGradient: { kind: 'radial', x1: 100, y1: 60, x2: 180, y2: 60, stops: [{ offset: 0, color: '#ff0000', alpha: 1 }, { offset: 1, color: '#0000ff', alpha: 0 }] } })])]),
  'gradient with alpha, stroked and turned': () => docOf([back, vec('A', [rect('a', 60, 30, null, { ...stroke, rot: [Math.cos(0.4), Math.sin(0.4), -Math.sin(0.4), Math.cos(0.4)], fillOpacity: 0.8, fillGradient: { kind: 'linear', x1: 60, y1: 30, x2: 120, y2: 90, stops: [{ offset: 0, color: '#00aa00', alpha: 0.9 }, { offset: 1, color: '#00aa00', alpha: 0.1 }] } })])]),
  'stroke inside': () => docOf([back, vec('A', [rect('a', 60, 30, '#ff0000', { ...stroke, strokeAlign: 'inside' })])]),
  'stroke outside': () => docOf([back, vec('A', [rect('a', 60, 30, '#ff0000', { ...stroke, strokeAlign: 'outside' })])]),
  // resvg draws a start marker unturned (no auto-start-reverse), so the reference has each head as an end marker.
  arrowheads: () => [
    docOf([vec('A', [line('l', [20, 30], [170, 90], { markerStart: 'triangle', markerEnd: 'circle' })])]),
    docOf([vec('A', [line('l', [170, 90], [20, 30], { markerEnd: 'triangle' }), line('m', [20, 30], [170, 90], { markerEnd: 'circle' })])]),
  ],
  'dashes and even-odd': () => docOf([vec('A', [rect('a', 20, 20, null, { ...stroke, strokeWidth: 4, dash: [3, 2] }), { id: 'p', type: 'path', d: 'M 100 20 L 180 20 L 180 100 L 100 100 Z M 120 40 L 160 40 L 160 80 L 120 80 Z', box0: { x: 100, y: 20, w: 80, h: 80 }, x: 100, y: 20, w: 80, h: 80, radius: 0, fill: '#aa00aa', stroke: null, strokeWidth: 0, fillRule: 'evenodd' } as VectorShape])]),
  picture: () => docOf([back, raster('R')]),
  'picture with opacity and blend': () => docOf([back, { ...raster('R'), opacity: 0.6, blend: 'screen' } as Layer]),
  'pixel mask': () => docOf([back, vec('A', [rect('a', 20, 20, '#ff0000', { w: 80, h: 80 })], { pixelMask: raster('M') } as never)]),
  'blurred shape in a faded group': () => docOf([back, vec('A', [rect('a', 70, 30, '#ff0000', { blur: 4, groupId: 'g' }), rect('b', 20, 20, '#0000ff', { w: 30, h: 30, groupId: 'g' })], group({ opacity: 0.6 }))]),
  'effect on everything below': () => docOf([back, vec('A', [rect('a', 60, 30, '#ff0000')]), fx('filter', 'below', 'invert', { amount: 1 })]),
  'effect on a layer': () => docOf([back, vec('A', [rect('a', 60, 30, '#ff0000')]), fx('effect', 'layer', 'shadow')]),
  'text as outlines in a faded, blended layer': () => docOf([back, { ...newTextLayer('Text', 'Hello World', { x: 20, y: 20, width: 160 }), fontSize: 28, fontFamily: 'Inter', color: '#1133aa', opacity: 0.5, blend: 'multiply' } as Layer]),
  turned: () => docOf([vec('A', [rect('a', 70, 30, '#ff0000', { rot: [Math.cos(0.5), Math.sin(0.5), -Math.sin(0.5), Math.cos(0.5)], rx: 10, ry: 10 })])]),
};

const has = (bin: string) => { try { execFileSync(bin, ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } };
const readers: Record<string, (pdf: string, out: string) => void> = {};
if (has('pdftoppm')) readers.poppler = (pdf, out) => { execFileSync('pdftoppm', ['-r', '96', '-singlefile', pdf, out.replace(/\.ppm$/, '')]); };
if (has('gs')) readers.ghostscript = (pdf, out) => { execFileSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=ppmraw', '-r96', '-dGraphicsAlphaBits=4', '-dTextAlphaBits=4', `-sOutputFile=${out}`, pdf]); };

/** A binary PPM (P6, 8 bit; Ghostscript adds a comment line): [width, height, offset of the first pixel]. */
function ppmHead(ppm: Uint8Array): [number, number, number] {
  const fields: number[] = [];
  let off = 2;
  while (fields.length < 3) {
    while (ppm[off] === 10 || ppm[off] === 32 || ppm[off] === 13 || ppm[off] === 9) off++;
    if (ppm[off] === 35) { while (ppm[off] !== 10) off++; continue; }
    let v = 0;
    while (ppm[off] >= 48 && ppm[off] <= 57) v = v * 10 + ppm[off++] - 48;
    fields.push(v);
  }
  return [fields[0], fields[1], off + 1];
}
function differ(ref: Uint8Array, ppm: Uint8Array): { bad: number; mean: number } {
  const [w, h, off] = ppmHead(ppm);
  if (w !== W || h !== H) return { bad: 100, mean: 255 };
  let bad = 0, sum = 0;
  for (let i = 0; i < W * H; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(ref[i * 4 + c] - ppm[off + i * 3 + c]));
    sum += d;
    if (d > 32) bad++;
  }
  return { bad: (100 * bad) / (W * H), mean: sum / (W * H) };
}
const pdfOf = async (doc: DesignDoc) => new Uint8Array(await (await svgToPdf(await docToSvg(doc, deps, undefined, { hidden: false, filters: false, text: 'paths' }), W, H)).arrayBuffer());
const text = (pdf: Uint8Array) => new TextDecoder('latin1').decode(pdf);

let dir = '';
beforeAll(async () => {
  await resvg.initWasm(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm')).catch(() => undefined);
  // An 80×80 picture with a soft-edged disc: colour and alpha both vary.
  png = dataUrl(new resvg.Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><defs><radialGradient id="g"><stop offset="0.5" stop-color="#0066ff"/><stop offset="1" stop-color="#0066ff" stop-opacity="0"/></radialGradient></defs><circle cx="40" cy="40" r="40" fill="url(#g)"/></svg>').render().asPng());
  dir = mkdtempSync(join(tmpdir(), 'ogs-pdf-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  notices.length = 0;
  vi.stubGlobal('Blob', NodeBlob);
  // jsdom loads no pictures: an Image that reports the PNG's own size (svg2pdf asks for it).
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; width = 0; height = 0; set src(v: string) { const b = Uint8Array.from(atob(v.slice(v.indexOf(',') + 1, v.indexOf(',') + 45)), (c) => c.charCodeAt(0)), d = new DataView(b.buffer); this.width = d.getUint32(16); this.height = d.getUint32(20); setTimeout(() => this.onload?.()); } });
  Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value() { return { x: 0, y: 0, width: 10, height: 10 }; } });
});

describe('PDF looks like the document', () => {
  it('has a PDF reader to draw with', () => { expect(Object.keys(readers), 'install poppler-utils (pdftoppm) or ghostscript: without one this contract checks nothing').not.toEqual([]); });

  for (const [name, make] of Object.entries(cases)) {
    it(name, async () => {
      const made = make(), [doc, same] = Array.isArray(made) ? made : [made, made];
      const ref = new resvg.Resvg(await docToSvg(same, plain, undefined, { hidden: false, text: 'paths' }), { background: '#ffffff' }).render().pixels;
      const pdf = await pdfOf(doc);
      writeFileSync(join(dir, 'case.pdf'), pdf);
      // PDF_OUT=<folder> keeps each case's PDF, to open in any other reader.
      if (process.env.PDF_OUT) writeFileSync(join(process.env.PDF_OUT, `${name.replace(/\W+/g, '-')}.pdf`), pdf);
      for (const [reader, draw] of Object.entries(readers)) {
        draw(join(dir, 'case.pdf'), join(dir, 'case.ppm'));
        const d = differ(ref, readFileSync(join(dir, 'case.ppm')));
        // Looser where edges are drawn differently: a picture of sharp shapes resampled by the reader, and
        // Ghostscript's antialiasing of any edge (the plain case alone is 1.5 % off there).
        const loose = name.startsWith('effect') || reader === 'ghostscript';
        if (process.env.PDF_OUT) console.log(`${name} · ${reader}: ${d.bad.toFixed(2)} % off, mean ${d.mean.toFixed(2)}`);
        expect(d.bad, `${reader}: % of pixels off`).toBeLessThanOrEqual(loose ? 2 : 0.5);
        expect(d.mean, `${reader}: mean difference`).toBeLessThan(loose ? 2.5 : 1.5);
      }
    });
  }
});

describe('PDF transparency is written the standard way', () => {
  it('a blended, faded group is one isolated transparency group painted with one state', async () => {
    const pdf = text(await pdfOf(docOf([back, vec('A', [rect('a', 60, 10, '#00aaff', { groupId: 'g' }), rect('b', 90, 40, '#ff00aa', { groupId: 'g' })], group({ blend: 'multiply', opacity: 0.5 }))])));
    expect(pdf).toContain('/Group <</S /Transparency /I true /CS /DeviceRGB>>');
    expect(pdf).toContain('<</Type /ExtGState /ca 0.5 /CA 0.5 /BM /Multiply >>');
    expect(pdf).toMatch(/\/OGs0 gs \/OGx0 Do/);
    expect(pdf).toContain('/Version /1.4');
  });

  it('a pixel mask is a soft mask by alpha; an outside stroke, one by luminosity', async () => {
    expect(text(await pdfOf(cases['pixel mask']() as DesignDoc))).toMatch(/\/SMask <<\/Type \/Mask \/S \/Alpha \/G \d+ 0 R>>/);
    expect(text(await pdfOf(cases['stroke outside']() as DesignDoc))).toMatch(/\/SMask <<\/Type \/Mask \/S \/Luminosity \/G \d+ 0 R>>/);
  });

  it('a document without those looks is written as before, with no groups', async () => {
    const pdf = text(await pdfOf(cases.plain() as DesignDoc));
    expect(pdf).not.toContain('/Transparency');
    expect(pdf).not.toContain('/OGs');
  });

  it('blur and effects go in as pictures of what they cover, and the export says so', async () => {
    const blurred = text(await pdfOf(cases['blurred shape in a faded group']() as DesignDoc));
    expect(notices).toEqual(['PDF has no equivalent for blur and effects, so these are pictures in this file: 1 blurred shape.']);
    // The picture is the blurred shape alone (its box plus the blur's reach), not the page; its group still fades it.
    expect(blurred).toMatch(/\/Subtype \/Image\s+\/Width 1[0-9]{2}\s+\/Height 1[0-9]{2}/);
    expect(blurred).toContain('/ca 0.6');
    notices.length = 0;
    await pdfOf(cases['effect on a layer']() as DesignDoc);
    expect(notices).toEqual(['PDF has no equivalent for blur and effects, so these are pictures in this file: “A” (Drop shadow).']);
  });

  it.skipIf(!readers.poppler)('on a print page with bleed and marks, a group lands where its shapes would', async () => {
    // One shape: a layer at half opacity (a group) and the shape itself at half opacity (no group) are the same picture.
    const grouped = docOf([back, vec('A', [rect('a', 60, 30, '#ff0000')], { opacity: 0.5 })]), folded = docOf([back, vec('A', [rect('a', 60, 30, '#ff0000', { fillOpacity: 0.5 })])]);
    const drawn: Uint8Array[] = [];
    for (const doc of [grouped, folded]) {
      const pdf = new Uint8Array(await (await svgToPdf(await docToSvg(doc, deps, undefined, { hidden: false }), W, H, { paper: 'a5', orientation: 'landscape' }, { bleedMm: 3, marks: true })).arrayBuffer());
      if (doc === grouped) expect(text(pdf)).toContain('/Transparency');
      writeFileSync(join(dir, 'page.pdf'), pdf);
      readers.poppler(join(dir, 'page.pdf'), join(dir, 'page.ppm'));
      drawn.push(readFileSync(join(dir, 'page.ppm')));
    }
    expect(drawn[0].length).toBe(drawn[1].length);
    // Only the one-pixel edge of the shape may differ (poppler antialiases inside a group its own way): under 0.1 %
    // of the page. A group placed without the page's offset or scale would differ over the whole shape (over 5 %).
    let off = 0;
    for (let i = 0; i < drawn[0].length; i++) if (Math.abs(drawn[0][i] - drawn[1][i]) > 32) off++;
    expect(off / drawn[0].length).toBeLessThan(0.001);
  });

  it('many faded groups stay cheap: 300 groups of 4 shapes in well under a second each hundred', async () => {
    const shapes = Array.from({ length: 1200 }, (_, i) => rect(`s${i}`, (i * 7) % 180, (i * 11) % 100, '#3366cc', { w: 12, h: 12, groupId: `g${Math.floor(i / 4)}` }));
    const groups = Array.from({ length: 300 }, (_, i) => ({ id: `g${i}`, name: `G${i}`, opacity: 0.5 }));
    const t0 = performance.now();
    const pdf = await pdfOf(docOf([vec('A', shapes, { objectGroups: groups } as never)]));
    const ms = performance.now() - t0;
    expect(text(pdf).match(/\/S \/Transparency \/I true/g)).toHaveLength(300);
    if (process.env.PDF_OUT) { console.log(`300 groups: ${ms.toFixed(0)} ms, ${pdf.length} bytes`); writeFileSync(join(process.env.PDF_OUT, 'many-groups.pdf'), pdf); }
    expect(ms).toBeLessThan(3000);
  }, 20000);
});
