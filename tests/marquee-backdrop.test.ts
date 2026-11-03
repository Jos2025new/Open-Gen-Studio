import { describe, expect, it, vi } from 'vitest';

// Raster layers by id: 'fill' painted over a 300×300 area larger than the page, 'blob' painted only at 10..40.
const boxes = vi.hoisted(() => ({ fill: { x: -50, y: -50, w: 300, h: 300 }, blob: { x: 10, y: 10, w: 30, h: 30 } } as Record<string, { x: number; y: number; w: number; h: number }>));
vi.mock('../src/engine/design/rasterBounds', () => ({ rasterPaintedBox: (l: { id: string }) => boxes[l.id] }));
vi.mock('../src/engine/design/raster', () => ({ getRasterSurface: () => ({ fw: 400, fh: 400, x0: 0, y0: 0, empty: false, canvas: { width: 400, height: 400 } }) }));
vi.mock('../src/engine/design/hitAlpha', () => ({ bufferAlpha: () => new Uint8Array(400 * 400).fill(255) }));

import type { DesignDoc, Layer } from '../src/engine/types';
import { marqueeFind } from '../src/engine/design/marqueePick';

const raster = (id: string): Layer => ({ id, type: 'raster', name: id, visible: true, locked: false, opacity: 1, blend: 'normal', x: -100, y: -100, width: 400, height: 400, paintStrokes: [] } as unknown as Layer);
const doc = (layers: Layer[]) => ({ id: 'd', layers, activeLayerId: layers[0].id } as unknown as DesignDoc);

describe('the marquee does not pick a backdrop it only crosses', () => {
  it('a fill wider than the rectangle is not picked, inside or across its edge', () => {
    expect(marqueeFind(doc([raster('fill')]), 10, 10, 40, 40).layers).toEqual([]);
    expect(marqueeFind(doc([raster('fill')]), 200, -80, 260, 20).layers).toEqual([]);
  });
  it('a painted area the rectangle holds is picked', () => {
    expect(marqueeFind(doc([raster('blob')]), 0, 0, 50, 50).layers).toEqual(['blob']);
  });
  it('the fill is picked once the rectangle holds all of it', () => {
    expect(marqueeFind(doc([raster('fill')]), -60, -60, 260, 260).layers).toEqual(['fill']);
  });
});
