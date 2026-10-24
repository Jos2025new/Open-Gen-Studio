import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { layerObjects, objectAt, translateObjects } from '../src/engine/design/objectOps';
import { setBuffer } from '../src/engine/design/raster';
import { pixelTarget } from '../src/engine/design/autoSelect';
import { editAreaOccupied } from '../src/components/designer/StageEditMarquee';
import { newRasterLayer } from '../src/engine/design/doc';
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

describe('Edit in Objects mode on a baked drawing (no strokes)', () => {
  const baked = (id: string) => ({ ...paint([]), id, paintBaseId: undefined, paintStrokes: undefined }) as RasterLayer;
  const other = baked('other'), active = baked('active');
  // Pixels painted at x 0..99 / y 0..99 of each layer, the rest transparent.
  const canvas = { width: 1000, height: 1000, getContext: () => ({ getImageData: () => { const d = new Uint8ClampedArray(4_000_000); for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) d[(y * 1000 + x) * 4 + 3] = 255; return { data: d }; } }) } as unknown as HTMLCanvasElement;
  for (const l of [other, active]) setBuffer(l.id, canvas, false);
  const doc = { layers: [other, active], activeLayerId: 'active' } as never;
  const onPixels = { x: 50, y: 50 }, empty = { x: 500, y: 500 };
  it('auto-select on: the topmost painted layer under the pointer is the target, active or not', () => {
    const d = { layers: [active, other], activeLayerId: 'active' } as never;
    expect(pixelTarget(d, 50, 50, true)?.id).toBe('other');
    expect(editAreaOccupied(d, onPixels, 'objects', true)).toBe(true);
  });
  it('auto-select off: only the active layer; other layers do nothing', () => {
    const d = { layers: [active, other], activeLayerId: 'other' } as never;
    expect(pixelTarget(doc, 50, 50, false)?.id).toBe('active');
    expect(pixelTarget(d, 50, 50, false)?.id).toBe('other');
    const none = { layers: [other], activeLayerId: 'zzz' } as never;
    expect(pixelTarget(none, 50, 50, false)).toBeNull();
    expect(editAreaOccupied(none, onPixels, 'objects', false)).toBe(false);
  });
  it('hidden or locked layers are never a target; transparent pixels start the marquee', () => {
    expect(pixelTarget({ layers: [{ ...active, locked: true }], activeLayerId: 'active' } as never, 50, 50, true)).toBeNull();
    expect(pixelTarget({ layers: [{ ...active, visible: false }], activeLayerId: 'active' } as never, 50, 50, false)).toBeNull();
    expect(pixelTarget(doc, empty.x, empty.y, true)).toBeNull();
    expect(editAreaOccupied(doc, empty, 'objects', true)).toBe(false);
  });
});
