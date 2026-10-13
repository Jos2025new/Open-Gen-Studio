// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DesignDoc, RasterLayer, VectorLayer } from '../src/engine/types';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));

import { describeReport, importSvg } from '../src/engine/design/svgImport';
import type { Rasterizer } from '../src/engine/design/svgImport/rasterize';
import { sanitizeSvg } from '../src/engine/design/svgImport/sanitize';
import { normalizePath } from '../src/engine/design/svgImport/pathData';
import { parseTransform, pageSetup } from '../src/engine/design/svgImport/transforms';
import { declarations, parsePaint } from '../src/engine/design/svgImport/styles';
import { shapeSvg } from '../src/engine/design/export';

const sample = readFileSync('tests/fixtures/inkscape-sample.svg', 'utf8');
const K = 96 / 25.4 * (210 / 210); // 1 viewBox unit → page px (210 mm wide page, viewBox 210)

/** Stands in for the rasterizer: records what it was asked and answers with the item's own box. */
function fakeRasterizer(calls: Array<{ reasons: string[]; svg: string; text: boolean }> = []): Rasterizer {
  return async (item, page) => {
    calls.push({ reasons: item.reasons, svg: item.svgFor(item.hint, 1), text: item.text });
    const box = { x: Math.max(0, item.hint.x), y: Math.max(0, item.hint.y), w: Math.min(item.hint.w, page.width), h: item.hint.h };
    return { box, canvas: { width: Math.ceil(box.w), height: Math.ceil(box.h) } as HTMLCanvasElement, engine: 'browser' };
  };
}
async function load(rasterizer = fakeRasterizer()) {
  const res = await importSvg(sample, 'sample', rasterizer);
  if ('error' in res) throw new Error(res.error);
  return res;
}
const names = (d: DesignDoc) => d.layers.map((l) => l.name);
const groupName = (d: DesignDoc, l: { groupId?: string }) => d.groups?.find((g) => g.id === l.groupId)?.name;

describe('Inkscape SVG import: structure', () => {
  it('page size comes from width/height; layers and groups become folders in order, with their names', async () => {
    const { doc } = await load();
    expect([doc.width, doc.height]).toEqual([Math.round(210 * 96 / 25.4), Math.round(297 * 96 / 25.4)]);
    expect(doc.groups?.map((g) => g.name)).toEqual(['Fondo', 'Formas', 'Formas / Grupo uno', 'Oculta', 'Bloqueada']);
    // Paint order is the document order: Fondo, Formas (blurred ellipse, gradient picture, text picture), group, hidden, locked.
    expect(doc.layers.map((l) => [l.type, groupName(doc, l)])).toEqual([
      ['vector', 'Fondo'], ['vector', 'Formas'], ['raster', 'Formas'], ['raster', 'Formas'], ['vector', 'Formas / Grupo uno'], ['vector', 'Oculta'], ['vector', 'Bloqueada'],
    ]);
    expect(names(doc)[0]).toBe('Fondo');
    expect(names(doc)[4]).toBe('special'); // a lone shape is named by its id (or inkscape:label)
  });

  it('consecutive shapes of one container share a vector layer', async () => {
    const { doc } = await load();
    expect((doc.layers[0] as VectorLayer).shapes.map((s) => s.type)).toEqual(['rect', 'path']);
  });

  it('keeps visibility (display:none), lock (sodipodi:insensitive) and group opacity', async () => {
    const { doc } = await load();
    const by = (g: string) => doc.layers.filter((l) => groupName(doc, l) === g);
    expect(by('Oculta')[0].visible).toBe(false);
    expect(by('Fondo')[0].visible).toBe(true);
    expect(by('Bloqueada')[0].locked).toBe(true);
    expect(by('Fondo')[0].locked).toBe(false);
    expect(by('Formas').map((l) => l.opacity)).toEqual([0.5, 0.5, 0.5]);
    expect(by('Formas / Grupo uno')[0].opacity).toBe(0.5);
    expect(by('Fondo')[0].opacity).toBe(1);
  });
});

describe('Inkscape SVG import: editable shapes', () => {
  it('rect: position, size, rx and ry scaled to the page; fill/stroke opacity, join, dashes in stroke widths', async () => {
    const { doc } = await load();
    const r = (doc.layers[0] as VectorLayer).shapes[0];
    expect(r).toMatchObject({ type: 'rect', fill: '#ff0000', stroke: '#00ff00', fillOpacity: 0.5, strokeOpacity: 0.25, join: 'bevel', cap: 'butt', dash: [2, 1] });
    expect(r.x).toBeCloseTo(10 * K, 3);
    expect(r.w).toBeCloseTo(50 * K, 3);
    expect(r.h).toBeCloseTo(30 * K, 3);
    expect(r.rx).toBeCloseTo(5 * K, 3);
    expect(r.ry).toBeCloseTo(3 * K, 3);
    expect(r.strokeWidth).toBeCloseTo(2 * K, 3);
    expect(shapeSvg({ ...r, id: 'x' })).toContain('fill-opacity="0.5"');
  });

  it('path with relative commands, H/V and an arc: absolute M L C Z in page coordinates, CSS class applied', async () => {
    const { doc } = await load();
    const p = (doc.layers[0] as VectorLayer).shapes[1];
    expect(p.type).toBe('path');
    expect(p.fill).toBe('#336699');
    expect(p.stroke).toBe('#000000');
    expect(p.strokeWidth).toBeCloseTo(0.5 * K, 3);
    expect(p.d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+ C .* L .* Z$/);
    expect(p.d!.replace(/[MLCZ]/g, '')).not.toMatch(/[a-zA-Z]/);
    // The arc ends where the SVG says: (30, 120) + (-10, 10) = (20, 130).
    expect(p.d).toContain(`${Math.round(20 * K * 1000) / 1000} ${Math.round(130 * K * 1000) / 1000}`);
    expect(p.box0!.x).toBeCloseTo(10 * K, 2);
  });

  it('ellipse with a single feGaussianBlur: blur σ in page px, scaled with the page', async () => {
    const { doc } = await load();
    const e = (doc.layers[1] as VectorLayer).shapes[0];
    expect(e).toMatchObject({ type: 'ellipse', fill: '#0000ff' });
    expect(e.blur).toBeCloseTo(2.5 * K, 3);
    expect(e.w).toBeCloseTo(40 * K, 3);
  });

  it('circle: ellipse; an id rule from <style> gives its fill', async () => {
    const { doc } = await load();
    const c = (doc.layers[4] as VectorLayer).shapes[0];
    expect(c).toMatchObject({ type: 'ellipse', fill: '#ff00ff' });
    expect(c.w).toBeCloseTo(20 * K, 3);
  });
});

describe('Inkscape SVG import: what is rasterized', () => {
  it('gradient fill and text become picture layers at their box and order, with the report to say so', async () => {
    const calls: Array<{ reasons: string[]; svg: string; text: boolean }> = [];
    const { doc, report } = await load(fakeRasterizer(calls));
    const g = doc.layers[2] as RasterLayer, t = doc.layers[3] as RasterLayer;
    expect([g.type, t.type]).toEqual(['raster', 'raster']);
    expect(g.name).toBe('gradrect');
    expect(g.x).toBeCloseTo(20 * K - 1, 1); // the box includes the stroke reach margin
    expect(g.y).toBeCloseTo(150 * K - 1, 1);
    expect(g.width).toBeCloseTo(40 * K + 2, 1);
    expect(g.height).toBeCloseTo(20 * K + 2, 1);
    expect(t.name).toBe('Text');
    expect(t.x).toBeCloseTo(20 * K, 1);
    expect(t.y).toBeLessThan(200 * K);
    expect(t.y + t.height).toBeGreaterThan(200 * K);
    expect(calls.map((c) => c.reasons)).toEqual([['gradient'], ['text']]);
    expect(calls[1].text).toBe(true);
    // Each standalone SVG carries the paint server it needs and its inherited style, but not the layer's opacity.
    expect(calls[0].svg).toContain('<linearGradient id="grad1"');
    expect(calls[0].svg).toContain('id="gradrect"');
    expect(calls[1].svg).toContain('font-size:12px');
    expect(calls[1].svg).not.toContain('opacity:0.5');
    expect(report).toMatchObject({ editable: 6, rasterized: 2, reasons: { gradient: 1, text: 1 } });
    expect(describeReport(report)).toBe('6 editable, 2 rasterized (gradient ×1, text ×1).');
  });

  it('a clip-path on a group rasterizes the whole group once', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><clipPath id="c"><rect width="10" height="10"/></clipPath><g clip-path="url(#c)"><rect width="50" height="50"/><circle cx="60" cy="60" r="10"/></g><rect x="70" y="70" width="5" height="5"/></svg>`;
    const calls: Array<{ reasons: string[]; svg: string; text: boolean }> = [];
    const res = await importSvg(svg, 't', fakeRasterizer(calls));
    if ('error' in res) throw new Error(res.error);
    expect(res.report).toMatchObject({ editable: 1, rasterized: 1, reasons: { 'clip-path': 1 } });
    expect(res.doc.layers.map((l) => l.type)).toEqual(['raster', 'vector']);
    expect(calls[0].svg).toContain('<circle');
  });

  it('use of a shape and of a symbol is expanded in place', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100"><defs><rect id="a" width="10" height="10" fill="#f00"/><symbol id="s" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></symbol></defs><use xlink:href="#a" x="20" y="30"/><use href="#s" x="50" y="50" width="20" height="20"/><use href="http://evil.test/x.svg#a"/></svg>`;
    const res = await importSvg(svg, 't', fakeRasterizer());
    if ('error' in res) throw new Error(res.error);
    const shapes = res.doc.layers.flatMap((l) => (l.type === 'vector' ? l.shapes : []));
    expect(shapes.map((s) => [s.type, s.x, s.y, s.w, s.h])).toEqual([['rect', 20, 30, 10, 10], ['ellipse', 50, 50, 20, 20]]);
  });

  it('a turned rectangle stays a rectangle with its turn', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="10" y="10" width="40" height="20" transform="rotate(30 30 20)"/></svg>`;
    const res = await importSvg(svg, 't', fakeRasterizer());
    if ('error' in res) throw new Error(res.error);
    const s = (res.doc.layers[0] as VectorLayer).shapes[0];
    expect(s.type).toBe('rect');
    expect(s.rot).toBeDefined();
    expect(s.w).toBeCloseTo(40, 6);
  });
});

describe('Inkscape SVG import: sanitizing', () => {
  const evil = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="50" height="50" onload="alert(1)">
    <script>alert(1)</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
    <style>@import url(http://evil.test/a.css); .a{fill:url(http://evil.test/p);} @font-face{font-family:x;src:url(http://evil.test/f.woff)}</style>
    <a xlink:href="javascript:alert(1)"><rect id="ok" width="5" height="5" onclick="alert(2)" style="fill:url(https://evil.test/x)"/></a>
    <image id="ext" href="http://evil.test/x.png" width="5" height="5"/>
    <image id="emb" href="data:image/png;base64,AAAA" width="5" height="5"/>
    <use href="http://evil.test/a.svg#x"/><set attributeName="href" to="javascript:alert(3)"/>
    <rect fill="url(#local)" stroke="url(//evil.test/s)" width="1" height="1"/>
  </svg>`;
  it('removes script, foreignObject, on* attributes, javascript: and external references; keeps data images and #refs', () => {
    const res = sanitizeSvg(evil);
    if ('error' in res) throw new Error(res.error);
    const out = new XMLSerializer().serializeToString(res.root);
    for (const bad of ['script', 'foreignObject', 'onload', 'onclick', 'javascript:', 'evil.test', '@import', '@font-face', '<set']) expect(out).not.toContain(bad);
    expect(out).toContain('data:image/png;base64,AAAA');
    expect(out).toContain('fill="url(#local)"');
    expect(out).not.toContain('id="ext"');
    expect(res.stats).toMatchObject({ script: 1, foreignobject: 1, 'on* attribute': 2 });
  });
  it('refuses entities and non-SVG input', () => {
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>')).toHaveProperty('error');
    expect(sanitizeSvg('<html><body/></html>')).toHaveProperty('error');
    expect(sanitizeSvg('<svg')).toHaveProperty('error');
  });
  it('importing the malicious file reports what was removed and creates no layer from the removed parts', async () => {
    const res = await importSvg(evil, 'evil', fakeRasterizer());
    if ('error' in res) throw new Error(res.error);
    expect(Object.keys(res.report.removed)).toContain('script');
    expect(describeReport(res.report)).toContain('Removed for safety');
  });
});

describe('svgImport helpers', () => {
  it('path data: relative, H/V, S/T, implicit lineto after M and a flag-glued arc', () => {
    expect(normalizePath('m10 10 20 0 0 20 h-20 z')!.d).toBe('M 10 10 L 30 10 L 30 30 L 10 30 Z');
    expect(normalizePath('M0 0 C 0 10 10 10 10 0 S 20 -10 20 0')!.d).toBe('M 0 0 C 0 10 10 10 10 0 C 10 -10 20 -10 20 0');
    expect(normalizePath('M0 0 Q 5 5 10 0 T 20 0')!.d).toBe('M 0 0 Q 5 5 10 0 Q 15 -5 20 0');
    const arc = normalizePath('M0 0 a5 5 0 1010 0')!; // large=1 sweep=0, glued flags
    expect(arc.d.startsWith('M 0 0 C')).toBe(true);
    expect(arc.box.w).toBeCloseTo(10, 2);
    expect(arc.box.h).toBeCloseTo(5, 2); // a half circle of radius 5
    expect(normalizePath('M0 0 L')).toBeNull();
    expect(normalizePath('L 1 1')).toBeNull();
    // A moved path: the matrix is applied to the points.
    expect(normalizePath('M0 0 L 1 1', [2, 0, 0, 2, 5, 5])!.d).toBe('M 5 5 L 7 7');
  });
  it('transforms, units and viewBox', () => {
    expect(parseTransform('translate(10 20) scale(2)')).toEqual([2, 0, 0, 2, 10, 20]);
    expect(parseTransform('rotate(90)')[1]).toBeCloseTo(1, 9);
    expect(parseTransform('garbage(1)')).toEqual([1, 0, 0, 1, 0, 0]);
    const svg = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 100 100"/>', 'image/svg+xml').documentElement;
    expect(pageSetup(svg)).toMatchObject({ width: 200, height: 100, matrix: [1, 0, 0, 1, 50, 0] });
  });
  it('CSS declarations keep semicolons inside url(); colours normalize', () => {
    expect(declarations('fill:#fff;background:url(data:image/png;base64,AA);stroke:red')).toEqual({ fill: '#fff', background: 'url(data:image/png;base64,AA)', stroke: 'red' });
    expect(parsePaint('rgb(255, 0, 0)')).toEqual({ kind: 'color', color: '#ff0000', alpha: 1 });
    expect(parsePaint('#0f0')).toEqual({ kind: 'color', color: '#00ff00', alpha: 1 });
    expect(parsePaint('url(#g)')).toEqual({ kind: 'ref', id: 'g' });
    expect(parsePaint('none')).toEqual({ kind: 'none' });
  });
});
