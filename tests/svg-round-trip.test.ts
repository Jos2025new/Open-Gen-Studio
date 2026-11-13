// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as resvg from '@resvg/resvg-wasm';
import type { DesignDoc, Layer, ObjectGroup, VectorLayer, VectorShape } from '../src/engine/types';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));

import { docToSvg, type SvgDeps } from '../src/engine/design/export';
import { importSvg } from '../src/engine/design/svgImport';

/*
 * The interchange contract (docs/intercambio-svg.md): what this app exports as SVG, it imports back as the same
 * document: layers, folders, nested groups, names, hidden and locked (as Inkscape writes them), group opacity and
 * blend, order and shapes. Checked by structure, and by exporting the imported document again and comparing pixels.
 */
const deps: SvgDeps = { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 };
const rect = (id: string, x: number, y: number, fill: string | null, extra: Partial<VectorShape> = {}): VectorShape => ({ id, type: 'rect', x, y, w: 30, h: 30, radius: 0, fill, stroke: null, strokeWidth: 0, ...extra } as VectorShape);
const vec = (id: string, shapes: VectorShape[], extra: Partial<VectorLayer> = {}): VectorLayer => ({ id, name: id, type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes, ...extra } as unknown as VectorLayer);
const docOf = (layers: Layer[], extra: Partial<DesignDoc> = {}): DesignDoc => ({ id: 'D', name: 'D', width: 200, height: 120, background: null, activeLayerId: layers[0].id, createdAt: 0, updatedAt: 0, layers, ...extra } as unknown as DesignDoc);

const art = vec('Art', [
  rect('a', 10, 10, '#ff0000', { groupId: 'logo' }),
  rect('b', 25, 25, '#00ff00', { groupId: 'logo', name: 'Green' }),
  rect('c', 40, 10, '#0000ff', { groupId: 'outer', name: 'Blue' }),
  rect('h', 80, 10, '#ffff00', { hidden: true, name: 'Hid' }),
  rect('k', 120, 10, '#00ffff', { locked: true, name: 'Lock' }),
  { ...rect('e', 10, 70, '#ff00ff', { groupId: 'off' }), type: 'ellipse' } as VectorShape,
  rect('s', 60, 70, null, { stroke: '#112233', strokeWidth: 4, join: 'round', cap: 'round', groupId: 'pinned', name: 'Frame' }),
  rect('t', 110, 70, '#808080', { rot: [Math.cos(0.5), Math.sin(0.5), -Math.sin(0.5), Math.cos(0.5)] }),
], { objectGroups: [
  { id: 'outer', name: 'Outer', opacity: 0.5, blend: 'multiply' }, { id: 'logo', name: 'Logo', parentId: 'outer' },
  { id: 'off', name: 'Off', hidden: true }, { id: 'pinned', name: 'Pinned', locked: true },
] as ObjectGroup[] });
const source = docOf([
  vec('Base', [rect('z', 0, 0, '#eeeeee', { w: 200, h: 120 } as Partial<VectorShape>)], { locked: true }),
  art,
  vec('Glow', [rect('g1', 100, 40, '#ffaa00')], { opacity: 0.6, blend: 'screen', groupId: 'F' } as Partial<VectorLayer>),
  vec('Notes', [rect('n1', 150, 80, '#000000')], { visible: false, groupId: 'F' } as Partial<VectorLayer>),
], { groups: [{ id: 'F', name: 'Extras' }] });

const stroke = { stroke: '#112233', strokeWidth: 4, join: 'bevel', cap: 'square' } as const;
const looks = docOf([vec('Looks', [
  rect('l1', 10, 10, '#ff0000', { fillOpacity: 0.4, rx: 6, ry: 3 }),
  rect('l2', 50, 10, null, { ...stroke, strokeOpacity: 0.5 }),
  rect('l3', 90, 10, '#00aa00', { ...stroke, join: 'miter', miter: 2, cap: 'butt', paintOrder: 'stroke' }),
  rect('l4', 130, 10, null, { fillGradient: { kind: 'linear', x1: 130, y1: 10, x2: 160, y2: 40, stops: [{ offset: 0, color: '#ff0000', alpha: 1 }, { offset: 1, color: '#0000ff', alpha: 0.5 }] } }),
  rect('l5', 10, 60, '#3366ff', { blur: 3 }),
  { id: 'l6', type: 'line', x: 60, y: 60, w: 30, h: 30, radius: 0, fill: null, ...stroke, dash: [2, 1], dashOffset: 0.5 } as VectorShape,
  { id: 'l7', type: 'path', d: 'M 100 60 L 130 60 L 115 90 Z', box0: { x: 100, y: 60, w: 30, h: 30 }, x: 100, y: 60, w: 30, h: 30, radius: 0, fill: '#aa00aa', stroke: null, strokeWidth: 0, fillRule: 'evenodd' } as VectorShape,
  rect('l9', 10, 95, '#ffcc00', { ...stroke, strokeAlign: 'inside', dash: [3, 1], name: 'Inside' }),
  rect('l10', 50, 95, '#ffcc00', { ...stroke, strokeAlign: 'outside', paintOrder: 'stroke', blur: 2, locked: true }),
  { id: 'l11', type: 'line', x: 90, y: 100, w: 40, h: 10, radius: 0, fill: null, ...stroke, markerStart: 'circle', markerEnd: 'triangle', name: 'Arrow', hidden: true } as VectorShape,
  { ...rect('l8', 150, 60, '#00aaaa'), type: 'ellipse', fillGradient: { kind: 'radial', x1: 165, y1: 75, x2: 180, y2: 75, stops: [{ offset: 0, color: '#ffffff', alpha: 1 }, { offset: 1, color: '#000000', alpha: 1 }] }, fill: null } as VectorShape,
])]);

/** The document without what an import renews (ids) and with numbers rounded: what has to come back. */
function shapeOf(doc: DesignDoc) {
  const round = (v: unknown): unknown => typeof v === 'number' ? +v.toFixed(3) : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;
  return {
    size: [doc.width, doc.height],
    layers: doc.layers.map((l) => {
      const v = l as VectorLayer, groups = new Map((v.objectGroups ?? []).map((g) => [g.id, g]));
      const path = (id?: string): string => { const g = id ? groups.get(id) : undefined; return g ? `${path(g.parentId)}/${g.name}` : ''; };
      return {
        name: l.name, type: l.type, visible: l.visible, locked: l.locked, opacity: +l.opacity.toFixed(3), blend: l.blend, folder: doc.groups?.find((g) => g.id === l.groupId)?.name ?? null,
        groups: (v.objectGroups ?? []).map((g) => ({ path: path(g.id), hidden: !!g.hidden, locked: !!g.locked, opacity: g.opacity ?? 1, blend: g.blend ?? 'normal' })).sort((a, b) => a.path.localeCompare(b.path)),
        // Without a stroke its width, join and cap say nothing (SVG's defaults come back for them).
        shapes: (v.shapes ?? []).map(({ id: _id, groupId, ...s }) => round({
          ...s, ...(s.stroke || s.strokeGradient ? {} : { strokeWidth: 0, join: undefined, cap: undefined }),
          radius: s.radius || 0, group: path(groupId), name: s.name ?? null, hidden: !!s.hidden, locked: !!s.locked,
        })),
      };
    }),
  };
}
async function back(doc: DesignDoc): Promise<DesignDoc> {
  const res = await importSvg(await docToSvg(doc, deps), doc.name, async () => { throw new Error('nothing of this document needs a picture'); });
  if ('error' in res) throw new Error(res.error);
  expect(res.report).toMatchObject({ rasterized: 0, warnings: [] });
  return res.doc;
}

beforeAll(async () => { await resvg.initWasm(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm')).catch(() => undefined); });

describe('SVG round trip: export, then import', () => {
  it('writes hidden and locked as Inkscape does, on layers, groups and shapes', async () => {
    const svg = await docToSvg(source, deps);
    expect(svg).toContain('inkscape:label="Hid" display="none"');
    expect(svg).toContain('inkscape:label="Lock" sodipodi:insensitive="true"');
    expect(svg).toMatch(/inkscape:label="Off" display="none"/);
    expect(svg).toMatch(/inkscape:label="Pinned" sodipodi:insensitive="true"/);
    expect(svg).toMatch(/inkscape:label="Notes" style="display:none"/);
    expect(svg).toMatch(/inkscape:label="Base" sodipodi:insensitive="true"/);
    // A file for the web or a PDF leaves the hidden out.
    const small = await docToSvg(source, deps, undefined, { hidden: false });
    expect(small).not.toContain('display');
    expect(small).not.toContain('#ffff00');
  });

  it('the same document comes back: layers, folder, nested groups, names, states, looks, order and shapes', async () => {
    expect(shapeOf(await back(source))).toEqual(shapeOf(source));
  });

  it('looks come back: opacities, corners, dashes, joins, paint order, gradients, blur, line, path, fill rule, inside and outside strokes, arrowheads', async () => {
    expect(shapeOf(await back(looks))).toEqual(shapeOf(looks));
  });

  it('a second trip changes nothing, and the picture is the same to the pixel', async () => {
    const once = await back(source), twice = await back(once);
    expect(shapeOf(twice)).toEqual(shapeOf(once));
    const px = async (d: DesignDoc) => new resvg.Resvg(await docToSvg(d, deps)).render().pixels;
    const a = await px(source), b = await px(once);
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    expect(a.length).toBe(200 * 120 * 4);
    expect(worst).toBeLessThanOrEqual(1);
  });
});
