import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { layerObjects, objectAt, translateObjects } from '../src/engine/design/objectOps';
import { topObjectLayer } from '../src/engine/design/autoSelect';
import { newRasterLayer, newVectorLayer } from '../src/engine/design/doc';
import type { RasterLayer, RasterStroke } from '../src/engine/types';

const stroke = (id: string, x0: number, y0: number, x1: number, y1: number): RasterStroke => ({ id, x: 0, y: 0, segments: [[x0, y0, x1, y1, 10]], color: '#fff', opacity: 1, erase: false });
const paint = (strokes: RasterStroke[], extra: Partial<RasterLayer> = {}): RasterLayer =>
  ({ ...newRasterLayer('Paint', { x: 0, y: 0, width: 1000, height: 1000 }, { width: 1000, height: 1000 }), paintBaseId: 'b', paintStrokes: strokes, ...extra });

describe('painted strokes of a layer that is shown through a transform', () => {
  // The layer is drawn shifted 300 px right: strokes are stored in the layer's own pixels, the page sees them moved.
  const shifted = paint([stroke('a', 100, 100, 200, 100)], { transform: [1, 0, 0, 1, 300, 0] });
  it('are picked where they are drawn, not where their own pixels are', () => {
    expect(objectAt(shifted, 450, 100)).toBe('a');
    expect(objectAt(shifted, 150, 100)).toBeNull();
    expect(layerObjects(shifted)[0].box.x).toBeCloseTo(395, 0);
  });
  it('follow a page drag through a turned layer (90 degrees: page right = layer up)', () => {
    const turned = paint([stroke('a', 100, 100, 200, 100)], { transform: [0, 1, -1, 0, 1000, 0] });
    const moved = translateObjects(turned, ['a'], 20, 0) as RasterLayer;
    expect(moved.paintStrokes![0].x).toBeCloseTo(0, 5);
    expect(moved.paintStrokes![0].y).toBeCloseTo(-20, 5);
  });
});

describe('a click in Objects mode falls on the top object of any visible, unlocked layer', () => {
  const active = paint([stroke('a', 100, 100, 200, 100)]);
  const other = { ...paint([stroke('b', 600, 600, 700, 600)]), id: 'other' } as RasterLayer;
  const hits = (l: RasterLayer | ReturnType<typeof newVectorLayer>, x: number, y: number) => Boolean(objectAt(l, x, y));
  it('takes the strokes of another layer when the active one has nothing there', () => {
    const layers = [other, active];
    expect(hits(active, 650, 600)).toBe(false);
    expect(topObjectLayer(layers, (l) => hits(l as RasterLayer, 650, 600))?.id).toBe('other');
  });
  it('skips hidden and locked layers, and takes the topmost of several', () => {
    const top = { ...other, id: 'top' } as RasterLayer;
    expect(topObjectLayer([top, other], (l) => hits(l as RasterLayer, 650, 600))?.id).toBe('other');
    expect(topObjectLayer([{ ...other, visible: false }, { ...top, locked: true }], () => true)).toBeNull();
    expect(topObjectLayer([other, active], () => true)?.id).toBe(active.id);
  });
});
