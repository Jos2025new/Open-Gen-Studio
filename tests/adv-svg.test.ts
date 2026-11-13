// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { DesignDoc, Layer, ObjectGroup, VectorLayer, VectorShape } from '../src/engine/types';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));

import { docToSvg, type SvgDeps } from '../src/engine/design/export';
import { importSvg } from '../src/engine/design/svgImport';
import { flattenSvg } from '../src/engine/design/svgImport/flatten';
import { unsafeUseExpansion } from '../src/engine/design/svgImport/useBudget';
import type { Rasterizer } from '../src/engine/design/svgImport/rasterize';

/* Ataques a la importación de SVG y a su ida y vuelta: entradas rotas, peligrosas, enormes o profundamente anidadas. */

const fakeRaster: Rasterizer = async (item, page) => {
  const box = { x: Math.max(0, item.hint.x), y: Math.max(0, item.hint.y), w: Math.min(item.hint.w, page.width), h: item.hint.h };
  return { box, canvas: { width: Math.max(1, Math.ceil(box.w)), height: Math.max(1, Math.ceil(box.h)) } as HTMLCanvasElement, engine: 'browser' };
};
const svgOf = (body: string, attrs = 'width="200" height="120"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const vectors = (layers: Layer[]) => layers.filter((l): l is VectorLayer => l.type === 'vector');
const allShapes = (layers: Layer[]): VectorShape[] => vectors(layers).flatMap((l) => l.shapes);

describe('importar SVG: entradas que no son SVG o no se pueden leer', () => {
  it.each([
    ['vacío', ''],
    ['texto', 'hola, no soy svg'],
    ['html', '<html><body><svg/></body></html>'],
    ['con entidades (billion laughs)', '<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg"><rect>&a;</rect></svg>'],
  ])('%s: devuelve error, no lanza', async (_, text) => {
    const res = await importSvg(text, 't', fakeRaster);
    expect('error' in res).toBe(true);
  });

  it('un SVG sin nada dibujable importa sin capas ni errores', async () => {
    const res = await importSvg(svgOf(''), 't', fakeRaster);
    expect('doc' in res && res.doc.layers).toEqual([]);
    expect('doc' in res && res.report.editable).toBe(0);
  });
});

describe('importar SVG: tamaños extremos', () => {
  it('ancho y alto negativos, cero o no numéricos dan un documento de al menos 1 px, finito', async () => {
    for (const attrs of ['width="-5" height="0"', 'width="abc" height="NaN"']) {
      const res = await importSvg(svgOf('<rect x="1" y="1" width="5" height="5" fill="red"/>', attrs), 't', fakeRaster);
      expect('doc' in res, attrs).toBe(true);
      if (!('doc' in res)) continue;
      expect(Number.isFinite(res.doc.width) && res.doc.width >= 1, `${attrs} width=${res.doc.width}`).toBe(true);
      expect(Number.isFinite(res.doc.height) && res.doc.height >= 1, `${attrs} height=${res.doc.height}`).toBe(true);
    }
  });

  it('un lienzo enorme se reduce a 8192 px como máximo', async () => {
    const res = await importSvg(svgOf('<rect width="10" height="10" fill="red"/>', 'width="1000000" height="1"'), 't', fakeRaster);
    expect('doc' in res && res.doc.width <= 8192).toBe(true);
  });

  it('warns instead of importing geometry when finite transforms overflow', async () => {
    const res = await importSvg(svgOf('<g transform="scale(1e200)"><rect width="1" height="1" transform="scale(1e200)"/></g>'), 't', fakeRaster);
    if (!('doc' in res)) throw new Error('import failed');
    expect(res.report.warnings.join(' ')).toMatch(/non-finite transform/i);
    for (const shape of allShapes(res.doc.layers)) expect([shape.x, shape.y, shape.w, shape.h].every(Number.isFinite)).toBe(true);
  });

  it('warns instead of importing non-finite stroke dashes', async () => {
    const res = await importSvg(svgOf('<rect width="5" height="5" stroke="black" stroke-dasharray="1e400 2"/>'), 't', fakeRaster);
    if (!('doc' in res)) throw new Error('import failed');
    expect(res.report.warnings.join(' ')).toMatch(/non-finite values/i);
    expect(allShapes(res.doc.layers)).toHaveLength(0);
  });

  it('retains finite scientific notation', async () => {
    const res = await importSvg(svgOf('<rect x="1e1" y="2e0" width="5" height="5"/>'), 't', fakeRaster);
    if (!('doc' in res)) throw new Error('import failed');
    expect(allShapes(res.doc.layers)[0].x).toBe(10);
  });

  it('keeps nested non-finite viewBox coordinates out of imported geometry', async () => {
    const res = await importSvg(svgOf('<svg width="20" height="20" viewBox="1e400 0 10 10"><rect width="5" height="5"/></svg>'), 't', fakeRaster);
    if (!('doc' in res)) throw new Error('import failed');
    for (const shape of allShapes(res.doc.layers)) expect([shape.x, shape.y, shape.w, shape.h].every(Number.isFinite)).toBe(true);
  });

  it('ancho 1e400 (Infinity) y alto -1e400 dan un documento con ancho finito (SVG index/structure: pageSetup sin guarda)', async () => {
    const res = await importSvg(svgOf('<rect x="1" y="1" width="5" height="5" fill="red"/>', 'width="1e400" height="-1e400"'), 't', fakeRaster);
    expect('doc' in res && Number.isFinite(res.doc.width) && res.doc.width >= 1).toBe(true);
  });

  it('coordenadas NaN o infinitas no llegan a las formas importadas (x="abc", y="1e400"): la forma sale con null en x, y, w, h (transforms.ts parseLength / shapes.ts)', async () => {
    // Causa: parseLength devuelve NaN/Infinity y buildShape no lo descarta; la forma entra en el documento.
    const res = await importSvg(svgOf('<rect x="abc" y="1e400" width="10" height="10" fill="red"/>'), 't', fakeRaster);
    expect('doc' in res).toBe(true);
    if (!('doc' in res)) return;
    for (const s of allShapes(res.doc.layers)) expect([s.x, s.y, s.w, s.h].every(Number.isFinite), JSON.stringify(s)).toBe(true);
  });

});

describe('importar SVG: seguridad (lo que se quita y lo que se cuenta)', () => {
  it('quita script, on*, href externo y javascript:, y lo cuenta', async () => {
    const svg = svgOf('<script>alert(1)</script><rect onclick="x()" x="1" y="1" width="10" height="10" fill="red"/><a href="javascript:alert(2)"><rect x="2" y="2" width="10" height="10" fill="blue"/></a><image href="http://evil.example/x.png" x="0" y="0" width="10" height="10"/>');
    const res = await importSvg(svg, 't', fakeRaster);
    expect('doc' in res).toBe(true);
    if (!('doc' in res)) return;
    expect(res.report.removed['script']).toBeGreaterThan(0);
    expect(res.report.removed['on* attribute']).toBeGreaterThan(0);
    expect(res.report.removed['external href']).toBeGreaterThan(0);
    expect(JSON.stringify(res.doc)).not.toMatch(/alert\(|evil\.example/);
  });

  it('@import y url() externos en <style> y en style= se quitan', async () => {
    const svg = svgOf('<style>@import url(http://evil.example/a.css); rect { fill: url(http://evil.example/p.svg#g) }</style><rect x="1" y="1" width="10" height="10" style="fill:url(https://evil.example/q.svg#z)"/>');
    const res = await importSvg(svg, 't', fakeRaster);
    expect('doc' in res && res.report.removed['css @import']).toBeGreaterThan(0);
    expect('doc' in res && res.report.removed['external url()']).toBeGreaterThan(0);
    expect(JSON.stringify('doc' in res ? res.doc : {})).not.toMatch(/evil\.example/);
  });

  it('una referencia a sí mismo con <use> termina y avisa', async () => {
    const svg = svgOf('<defs><g id="a"><use href="#a"/><rect x="1" y="1" width="5" height="5" fill="red"/></g></defs><use href="#a"/>');
    const res = await importSvg(svg, 't', fakeRaster);
    expect('doc' in res).toBe(true);
    if (!('doc' in res)) return;
    expect(res.report.warnings.join(' ')).toMatch(/into itself|pointing nowhere/);
  });
});

describe('importar SVG: anidado y <use> repetido', () => {
  it('bounds referenced content via an XLink alias and whitespace', () => {
    const xml = svgOf('<defs><g id="target"><rect/><rect/><rect/></g></defs><use xmlns:link="http://www.w3.org/1999/xlink" link:href="  #target"/>');
    const root = new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement;
    expect(unsafeUseExpansion(root, 2)).toBe(true);
  });

  it('accepts a small reachable use graph before rasterization', () => {
    const root = new DOMParser().parseFromString(svgOf('<defs><g id="target"><rect/></g></defs><use href="#target"/>'), 'image/svg+xml').documentElement;
    expect(unsafeUseExpansion(root)).toBe(false);
  });

  it('does not reject unused cyclic definitions beside raster content', async () => {
    const raster = vi.fn(fakeRaster);
    const res = await importSvg(svgOf('<defs><g id="unused"><use href="#unused"/></g></defs><text x="10" y="30">Visible</text>'), 't', raster);
    expect('doc' in res).toBe(true);
    expect(raster).toHaveBeenCalledTimes(1);
  });

  it('rejects exponential use expansion before flattening in the browser', async () => {
    let body = '<rect id="flat0" width="1" height="1"/>';
    for (let i = 1; i <= 13; i++) body += `<g id="flat${i}"><use href="#flat${i - 1}"/><use href="#flat${i - 1}"/></g>`;
    const result = await flattenSvg(svgOf(`<defs>${body}</defs><use href="#flat13"/>`));
    expect(result).toMatch(/use expansion limit/i);
  });

  it('does not rasterize an expansion that exceeded the use budget', async () => {
    let body = '<rect id="limited0" width="1" height="1" fill="red"/>';
    for (let i = 1; i <= 13; i++) body += `<g id="limited${i}"><use href="#limited${i - 1}"/><use href="#limited${i - 1}"/></g>`;
    let called = false;
    const raster = async (...args: Parameters<typeof fakeRaster>) => { called = true; return fakeRaster(...args); };
    const res = await importSvg(svgOf(`<defs>${body}<mask id="m"><rect width="10" height="10" fill="white"/></mask></defs><g mask="url(#m)"><use href="#limited13"/></g>`), 't', raster);
    expect('error' in res && res.error).toMatch(/expansion limit/i);
    expect(called).toBe(false);
  });

  it('limits repeated use expansion and reports skipped content', async () => {
    let body = '<rect id="limit0" width="1" height="1" fill="red"/>';
    for (let i = 1; i <= 13; i++) body += `<g id="limit${i}"><use href="#limit${i - 1}"/><use href="#limit${i - 1}"/></g>`;
    const res = await importSvg(svgOf(`<defs>${body}</defs><use href="#limit13"/>`), 't', fakeRaster);
    if (!('doc' in res)) throw new Error('import failed');
    expect(res.report.warnings.join(' ')).toMatch(/expansion limit/i);
    expect(allShapes(res.doc.layers).length).toBeLessThan(8192);
  });

  it('<use> que apunta a <use> diez niveles atrás produce 2^10 formas exactas (crecimiento multiplicativo, sin límite)', async () => {
    let body = '<rect id="u0" x="0" y="0" width="1" height="1" fill="red"/>';
    for (let i = 1; i <= 10; i++) body += `<g id="u${i}"><use href="#u${i - 1}"/><use href="#u${i - 1}" x="${i}"/></g>`;
    const res = await importSvg(svgOf(`<defs>${body}</defs><use href="#u10"/>`), 't', fakeRaster);
    expect('doc' in res && allShapes(res.doc.layers).length).toBe(1024);
  });

  it('más de 64 niveles de grupos: el contenido no se pierde en silencio (structure.ts MAX_DEPTH)', async () => {
    // Causa: walk corta en ctx.depth > MAX_DEPTH sin avisar; la forma del fondo desaparece sin rastro en el informe.
    let body = '<rect x="150" y="10" width="10" height="10" fill="#f00" id="deep"/>';
    for (let i = 0; i < 80; i++) body = `<g>${body}</g>`;
    const res = await importSvg(svgOf(body), 't', fakeRaster);
    expect('doc' in res).toBe(true);
    if (!('doc' in res)) return;
    expect(allShapes(res.doc.layers).length > 0 || res.report.warnings.length > 0).toBe(true);
  });
});

describe('importar SVG: aspecto y estructura', () => {
  it('un <g> vacío no deja grupo en el documento', async () => {
    const res = await importSvg(svgOf('<g id="E"/><rect x="1" y="1" width="5" height="5" fill="red"/>'), 't', fakeRaster);
    expect('doc' in res && vectors(res.doc.layers).every((l) => !l.objectGroups?.length)).toBe(true);
  });

  it('una capa de Inkscape oculta llega oculta y con sus formas', async () => {
    const svg = svgOf('<g inkscape:groupmode="layer" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:label="L" style="display:none"><rect x="1" y="1" width="5" height="5" fill="red"/></g>');
    const res = await importSvg(svg, 't', fakeRaster);
    expect('doc' in res && vectors(res.doc.layers).map((l) => [l.name, l.visible, l.shapes.length])).toEqual([['L', false, 1]]);
  });

  it('opacidad de una forma con fill y stroke: se envuelve en un grupo de esa opacidad', async () => {
    const res = await importSvg(svgOf('<rect x="1" y="1" width="5" height="5" opacity="0.5" fill="#f00" stroke="#00f" stroke-width="2"/>'), 't', fakeRaster);
    if (!('doc' in res)) throw new Error('error');
    const l = vectors(res.doc.layers)[0];
    expect(l.objectGroups?.some((g) => g.opacity === 0.5)).toBe(true);
  });

  it('opacidad de una forma con solo relleno: se pliega en el relleno (sin grupo)', async () => {
    const res = await importSvg(svgOf('<rect x="1" y="1" width="5" height="5" opacity="0.5" fill="#f00"/>'), 't', fakeRaster);
    if (!('doc' in res)) throw new Error('error');
    const l = vectors(res.doc.layers)[0];
    expect(l.objectGroups ?? []).toEqual([]);
    expect(l.shapes[0].fillOpacity).toBeCloseTo(0.5, 6);
  });

  it('mix-blend-mode en una forma llega como grupo con ese modo', async () => {
    const res = await importSvg(svgOf('<rect x="1" y="1" width="5" height="5" fill="#f00" style="mix-blend-mode:multiply"/>'), 't', fakeRaster);
    if (!('doc' in res)) throw new Error('error');
    const groups: ObjectGroup[] = vectors(res.doc.layers)[0].objectGroups ?? [];
    expect(groups.some((g) => g.blend === 'multiply')).toBe(true);
  });

  it('una <image> sin width/height (tamaño intrínseco) no desaparece en silencio (structure.ts walk, image)', async () => {
    // Causa: la rama de image exige w>0 y h>0 leídos de atributos; sin ellos se descarta sin aviso.
    const res = await importSvg(svgOf('<image href="data:image/png;base64,iVBORw0KGgo="/>'), 't', fakeRaster);
    if (!('doc' in res)) throw new Error('error');
    expect(res.doc.layers.length > 0 || res.report.warnings.length > 0).toBe(true);
  });
});

describe('ida y vuelta: nombres con caracteres especiales', () => {
  it('nombres de capa, grupo y forma con comillas, ángulos y ampersand vuelven idénticos', async () => {
    const deps: SvgDeps = { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 };
    const shape = (id: string, x: number, extra: Partial<VectorShape> = {}) => ({ id, type: 'rect', x, y: 0, w: 10, h: 10, radius: 0, fill: '#123456', stroke: null, strokeWidth: 0, ...extra }) as VectorShape;
    const name = `A & "B" <C> 'd'`;
    const layer = { id: 'L1', name, type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [shape('s1', 1, { groupId: 'g1', name: `x'"<>&` }), shape('s2', 20, { groupId: 'g1' })], objectGroups: [{ id: 'g1', name: 'Gr <1> & "2"' }] } as unknown as VectorLayer;
    const doc = { id: 'D', name: 'D', width: 100, height: 40, background: null, activeLayerId: 'L1', createdAt: 0, updatedAt: 0, layers: [layer] } as unknown as DesignDoc;
    const svg = await docToSvg(doc, deps);
    const res = await importSvg(svg, 't', fakeRaster);
    if (!('doc' in res)) throw new Error('error');
    const back = vectors(res.doc.layers);
    expect(back.map((l) => l.name)).toEqual([name]);
    expect(back[0].objectGroups?.map((g) => g.name)).toEqual(['Gr <1> & "2"']);
    expect(back[0].shapes.find((s) => s.x === 1)?.name).toBe(`x'"<>&`);
  });
});

describe('exportar y volver a importar: bordes del documento', () => {
  const deps: SvgDeps = { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 };
  const shape = (id: string, x: number, extra: Partial<VectorShape> = {}) => ({ id, type: 'rect', x, y: 0, w: 10, h: 10, radius: 0, fill: '#123456', stroke: null, strokeWidth: 0, ...extra }) as VectorShape;
  const docWith = (layers: Layer[], extra: Partial<DesignDoc> = {}) => ({ id: 'D', name: 'D', width: 100, height: 40, background: null, activeLayerId: null, createdAt: 0, updatedAt: 0, layers, ...extra }) as unknown as DesignDoc;

  it('un documento sin capas exporta un SVG válido y vuelve sin capas', async () => {
    const svg = await docToSvg(docWith([]), deps);
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror')).toHaveLength(0);
    const res = await importSvg(svg, 't', fakeRaster);
    expect('doc' in res && res.doc.layers).toEqual([]);
  });

  it('la exportación no escribe NaN ni Infinity en el SVG (export.ts: sin guarda de coordenadas no finitas)', async () => {
    const layer = { id: 'L', name: 'L', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [shape('s', NaN)] } as unknown as VectorLayer;
    await expect(docToSvg(docWith([layer]), deps)).rejects.toThrow(/non-finite/i);
  });

  it('una capa de vector sin formas sobrevive a la ida y vuelta (structure/index: solo nace una capa por tanda de formas)', async () => {
    // Causa: importSvg crea capas de vector solo al vaciar formas pendientes; una capa vacía de Inkscape desaparece.
    const empty = { id: 'E', name: 'Empty', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [] } as unknown as VectorLayer;
    const svg = await docToSvg(docWith([empty]), deps);
    const res = await importSvg(svg, 't', fakeRaster);
    expect('doc' in res && res.doc.layers.map((l) => l.name)).toEqual(['Empty']);
  });
});
