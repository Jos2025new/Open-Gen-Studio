// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
import { createDoc, newRasterLayer, newTextLayer } from '../src/engine/design/doc';
import { layerObjects, objectAt, translateObjects, turnObjects } from '../src/engine/design/objectOps';
import { deletePicks } from '../src/engine/design/multiObjectOps';
import { exportGeometry } from '../src/engine/design/exportJob';
import { DEFAULT_EXPORT } from '../src/engine/design/exportSettings';
import { moveGroups, snapBox } from '../src/components/designer/stageObjMove';
import { useStore } from '../src/store/store';
import type { DesignDoc, Layer, RasterLayer } from '../src/engine/types';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ measureText: (s: string) => ({ width: s.length * 8 }) })) as never);
});
function fixture() {
  const image = newRasterLayer('Image', { x: 10, y: 20, width: 50, height: 40 }, { width: 50, height: 40 }, 'asset');
  const paint = newRasterLayer('Paint', { x: 80, y: 20, width: 50, height: 40 }, { width: 50, height: 40 });
  const text = { ...newTextLayer('Text', 'Hello', { x: 10, y: 90, width: 50 }), width: 50 };
  const doc = { ...createDoc('D', 200, 200), layers: [image, paint, text], activeLayerId: image.id };
  return { image, paint, text, doc };
}

describe('whole layers as objects', () => {
  it('exposes an image, unrecorded paint and text as one object each', () => {
    const { image, paint, text } = fixture();
    for (const layer of [image, paint, text]) expect(layerObjects(layer).map((o) => o.id)).toEqual([layer.id]);
    expect(objectAt(text, 12, 92)).toBe(text.id);
  });
  it('moves an entire image, paint or text without recomposing painted strokes', () => {
    const { image, paint, text } = fixture();
    for (const layer of [image, paint, text]) {
      const moved = translateObjects(layer, [layer.id], 7, 9) as Layer & { x: number; y: number };
      expect([moved.x, moved.y]).toEqual([layer.x + 7, layer.y + 9]);
    }
    expect(moveGroups([{ layerId: paint.id, ids: [paint.id], base: paint }], 7, 9)?.get(paint.id)).toMatchObject({ x: paint.x + 7, y: paint.y + 9 });
  });
  it('includes whole raster objects in snapping but excludes individual painted strokes', () => {
    const { image, paint } = fixture();
    const painted: RasterLayer = { ...paint, paintStrokes: [{ id: 'line', x: 0, y: 0, color: '#000', opacity: 1, erase: false, segments: [[1, 1, 10, 10, 2]] }] };
    expect(snapBox([{ layerId: image.id, ids: [image.id], base: image }])).toEqual(layerObjects(image)[0].box);
    expect(snapBox([{ layerId: paint.id, ids: ['line'], base: painted }])).toBeNull();
  });
  it('rotates a whole-layer object without changing its pixels', () => {
    const { image, text } = fixture();
    for (const layer of [image, text]) expect(turnObjects(layer, [layer.id], 'rotate-cw')).toHaveProperty('transform');
  });
  it('exports only a real whole-layer object and rejects a stale object id', () => {
    const { image, doc } = fixture();
    const settings = { ...DEFAULT_EXPORT, area: 'objects' as const };
    const geometry = exportGeometry(doc, settings, { objects: [{ layerId: image.id, ids: [image.id] }] });
    expect(geometry.doc.layers.map((l) => l.id)).toEqual([image.id]);
    expect(() => exportGeometry(doc, settings, { objects: [{ layerId: image.id, ids: ['missing'] }] })).toThrow(/No picked objects/);
  });
  it('keeps strokes on paintable images individually selectable', () => {
    const { image } = fixture();
    const painted: RasterLayer = { ...image, paintStrokes: [{ id: 'line', x: 0, y: 0, color: '#000', opacity: 1, erase: false, segments: [[1, 1, 10, 10, 2]] }] };
    expect(layerObjects(painted).map((object) => object.id)).toEqual([image.id, 'line']);
  });
  it('deletes selected whole-layer objects while preserving unrelated layers', () => {
    const { image, paint, text, doc } = fixture();
    const sid = useStore.getState().activeSessionId;
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], docs: [doc], activeDocId: doc.id } } }));
    deletePicks(sid, doc.id, doc as DesignDoc, [{ layerId: image.id, ids: [image.id] }, { layerId: text.id, ids: [text.id] }]);
    expect(useStore.getState().sessions[sid].docs[0].layers.map((l) => l.id)).toEqual([paint.id]);
  });
  it('keeps ordinary painted strokes as separate objects', () => {
    const { paint } = fixture();
    const painted: RasterLayer = { ...paint, paintStrokes: [{ id: 'line', x: 0, y: 0, color: '#000', opacity: 1, erase: false, segments: [[1, 1, 10, 10, 2]] }] };
    expect(layerObjects(painted).map((o) => o.id)).toEqual(['line']);
  });
});

it('recomposes a painted layer when its last stroke is removed', async () => {
  const { commitLayers, withoutObjects } = await import('../src/engine/design/objectOps');
  const rasterCompose = await import('../src/engine/design/rasterCompose');
  const compose = vi.spyOn(rasterCompose, 'composeRaster').mockReturnValue(true);
  const { paint, doc } = fixture();
  const painted: RasterLayer = { ...paint, paintBaseId: 'base', paintStrokes: [{ id: 'line', x: 0, y: 0, color: '#000', opacity: 1, erase: false, segments: [[1, 1, 10, 10, 2]] }] };
  const sid = useStore.getState().activeSessionId;
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], docs: [{ ...doc, layers: [painted] }], activeDocId: doc.id } } }));
  commitLayers(sid, doc.id, [withoutObjects(painted, ['line'])]);
  expect(compose).toHaveBeenCalledOnce();
  compose.mockRestore();
});
