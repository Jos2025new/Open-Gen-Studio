// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
import { createDoc, newRasterLayer } from '../src/engine/design/doc';
import { layerObjects, objectAt, translateObjects } from '../src/engine/design/objectOps';
import { objectBelow } from '../src/engine/design/objectBelow';
import type { RasterLayer } from '../src/engine/types';

function painted(): RasterLayer {
  const image = newRasterLayer('Image', { x: 10, y: 20, width: 50, height: 40 }, { width: 50, height: 40 }, 'asset');
  return { ...image, paintStrokes: [{ id: 'line', x: 0, y: 0, color: '#000', opacity: 1, erase: false, segments: [[5, 5, 20, 20, 3]] }] };
}

describe('an image with strokes (Illustrator: siblings in one layer)', () => {
  it('lists the image first, then its strokes', () => {
    const l = painted();
    expect(layerObjects(l).map((o) => o.id)).toEqual([l.id, 'line']);
  });
  it('a click on a stroke picks the stroke', () => {
    const l = painted();
    expect(objectAt(l, l.x + 10, l.y + 10)).toBe('line');
  });
  it('moving the image moves the whole layer, strokes included', () => {
    const l = painted();
    const moved = translateObjects(l, [l.id], 7, 9) as RasterLayer;
    expect([moved.x, moved.y]).toEqual([l.x + 7, l.y + 9]);
    expect(moved.paintStrokes).toEqual(l.paintStrokes);
  });
  it('Ctrl+Alt+click steps from the stroke to what lies below', () => {
    const l = painted();
    const doc = { ...createDoc('D', 200, 200), layers: [l], activeLayerId: l.id };
    const top = objectBelow(doc, l.x + 10, l.y + 10, []);
    expect(top).toEqual({ layerId: l.id, id: 'line' });
    const next = objectBelow(doc, l.x + 10, l.y + 10, [{ layerId: l.id, ids: ['line'] }]);
    expect(next?.layerId).toBe(l.id);
  });
});
