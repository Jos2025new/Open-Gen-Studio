import { describe, expect, it, vi } from 'vitest';

// A 100×100 raster layer: fully painted (a Fill), or painted only in its left half (a drawing).
const alphas = vi.hoisted(() => ({ full: new Uint8Array(100 * 100).fill(255), half: new Uint8Array(100 * 100).map((_, i) => (i % 100 < 50 ? 255 : 0)) }));
vi.mock('../src/engine/design/raster', () => ({ getRasterSurface: () => ({ fw: 100, fh: 100, x0: 0, y0: 0, empty: false, canvas: { width: 100, height: 100 } }) }));
vi.mock('../src/engine/design/hitAlpha', () => ({ bufferAlpha: (id: string) => (id === 'fill' ? alphas.full : alphas.half) }));

import type { DesignDoc, Layer } from '../src/engine/types';
import { marqueeFind } from '../src/engine/design/marqueePick';

const raster = (id: string): Layer => ({ id, type: 'raster', name: id, visible: true, locked: false, opacity: 1, blend: 'normal', x: 0, y: 0, width: 100, height: 100, paintStrokes: [] } as unknown as Layer);
const doc = (layers: Layer[]) => ({ id: 'd', layers, activeLayerId: layers[0].id } as unknown as DesignDoc);

describe('the marquee does not pick the backdrop it is drawn on', () => {
  it('a fully painted layer under the whole rectangle (a Fill) is not picked', () => {
    expect(marqueeFind(doc([raster('fill')]), 10, 10, 40, 40).layers).toEqual([]);
  });
  it('a drawing the rectangle only partly covers is still picked', () => {
    expect(marqueeFind(doc([raster('draw')]), 30, 10, 70, 40).layers).toEqual(['draw']);
  });
});
