// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DesignDoc, VectorLayer } from '../src/engine/types';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));

import { importSvg } from '../src/engine/design/svgImport';

/*
 * SVG as other apps write it (docs/intercambio-svg.md). The samples are small files written here after each app's
 * conventions, not exports of the apps themselves: they pin how the import reads those conventions.
 */
async function load(file: string) {
  const res = await importSvg(readFileSync(`tests/fixtures/${file}`, 'utf8'), file, async (item) => ({ box: item.hint, canvas: { width: Math.ceil(item.hint.w), height: Math.ceil(item.hint.h) } as HTMLCanvasElement, engine: 'browser' }));
  if ('error' in res) throw new Error(res.error);
  return res;
}
/** Layers as [type, name, folder], and a vector layer as an indented tree of its groups and shapes. */
const layersOf = (doc: DesignDoc) => doc.layers.map((l) => [l.type, l.name, doc.groups?.find((g) => g.id === l.groupId)?.name ?? null]);
function tree(l: VectorLayer): string[] {
  const groups = new Map((l.objectGroups ?? []).map((g) => [g.id, g])), out: string[] = [];
  const chain = (id?: string): string[] => { const g = id ? groups.get(id) : undefined; return g ? [...chain(g.parentId), g.id] : []; };
  let open: string[] = [];
  for (const s of l.shapes) {
    const c = chain(s.groupId);
    let k = 0;
    while (k < open.length && open[k] === c[k]) k++;
    for (let i = k; i < c.length; i++) { const g = groups.get(c[i])!; out.push(`${'  '.repeat(i)}[${g.name}${g.opacity !== undefined ? ` ${g.opacity}` : ''}${g.blend ? ` ${g.blend}` : ''}]`); }
    open = c;
    out.push(`${'  '.repeat(c.length)}${s.type}${s.name ? ` ${s.name}` : ''} ${s.fillGradient ? 'gradient' : s.fill ?? 'none'}${s.stroke ? `/${s.stroke}` : ''}`);
  }
  return out;
}

describe('Illustrator', () => {
  it('named groups on the page are layers, under the wrapper that isolates blending; inner groups are object groups', async () => {
    const { doc, report } = await load('illustrator-sample.svg');
    expect(report).toMatchObject({ editable: 7, rasterized: 0 });
    expect(layersOf(doc)).toEqual([['vector', 'Background', null], ['vector', 'Art work', null]]);
    expect(tree(doc.layers[1] as VectorLayer)).toEqual([
      '[Logo]', '  rect #f15a24', '  ellipse none/#1b1464',
      '[Group 0.5]', '  rect #f15a24', '  path #29abe2',
      'rect gradient',
      // A lone shape with a blend of its own: a group of one carries it.
      '[Group multiply]', '  path #f15a24',
    ]);
  });
  it('classes from the style sheet, grouped selectors too, give fill, stroke and miter', async () => {
    const { doc } = await load('illustrator-sample.svg');
    const ring = (doc.layers[1] as VectorLayer).shapes[1];
    expect(ring).toMatchObject({ type: 'ellipse', fill: null, stroke: '#1b1464', strokeWidth: 4, miter: 10 });
  });
});

describe('Figma', () => {
  it('the frame clip that covers the page cuts nothing: frame and groups are object groups with their names; fill="none" on the root is inherited', async () => {
    const { doc, report } = await load('figma-sample.svg');
    expect(report).toMatchObject({ editable: 6, rasterized: 1, reasons: { filter: 1 } });
    expect(layersOf(doc)).toEqual([['vector', 'Shapes', null], ['raster', 'Shadowed', null]]);
    expect(tree(doc.layers[0] as VectorLayer)).toEqual([
      '[Frame 1]', '  rect #ffffff',
      '  [Card]', '    rect Rectangle 1 #d9d9d9', '    ellipse Ellipse 1 gradient', '    path Vector 1 none/#000000',
      '  [Badge 0.5]', '    rect Rectangle 2 #ff0000', '    rect Rectangle 3 #0000ff/#000000',
    ]);
  });
});

describe('Canva', () => {
  it('a box clipped to itself or to less than its box stays a shape only when nothing is cut; a real cut is a picture', async () => {
    const { doc, report } = await load('canva-sample.svg');
    // Red: clip equal to the shape. Blue: the clip is smaller than the shape. Green: a round clip.
    expect(report).toMatchObject({ editable: 4, rasterized: 2, reasons: { 'clip-path': 2 } });
    expect(layersOf(doc).map((l) => l[0])).toEqual(['vector', 'raster', 'raster', 'vector']);
    expect(tree(doc.layers[0] as VectorLayer)).toEqual(['rect #ffffff', 'path #ff5757']);
    // Wrappers that say nothing leave no groups; the page is the viewBox scaled to width and height.
    expect(tree(doc.layers[3] as VectorLayer)).toEqual(['path none/#000000', 'path #000000']);
    expect([doc.width, doc.height]).toEqual([400, 200]);
  });
});
