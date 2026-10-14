import { describe, expect, it } from 'vitest';
import type { DesignDoc, VectorLayer } from '../src/engine/types';
import { mixedRectangleRadii, multiLayerRectangles, patchMultiLayerRectangles } from '../src/engine/design/multiRectEdit';

const vector = (id: string, shapes: any[], extra: Partial<VectorLayer> = {}): VectorLayer => ({
  id, name: id, type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes, ...extra,
});
const rect = (id: string, rx = 0) => ({ id, type: 'rect', x: 0, y: 0, w: 80, h: 40, fill: '#fff', stroke: null, strokeWidth: 0, radius: 0, rx });
const ellipse = { ...rect('oval'), type: 'ellipse' as const };
const doc = (layers: DesignDoc['layers']): DesignDoc => ({ id: 'd', name: 'd', width: 300, height: 200, background: null, activeLayerId: 'a', createdAt: 0, updatedAt: 0, layers });

describe('rounding selected rectangles across layers', () => {
  it('targets only visible, unlocked rectangles in the explicit layer selection', () => {
    const d = doc([
      vector('a', [rect('a1'), ellipse, rect('a2')]),
      vector('b', [rect('b1')]),
      vector('hidden', [rect('h')], { visible: false }),
      vector('locked', [rect('l')], { locked: true }),
    ]);
    expect(multiLayerRectangles(d, 'layers', null, ['a', 'b', 'hidden', 'locked'])).toEqual([
      { layerId: 'a', shapeId: 'a1' }, { layerId: 'a', shapeId: 'a2' }, { layerId: 'b', shapeId: 'b1' },
    ]);
  });

  it('targets every picked rectangle in Objects on one layer, but rejects a mixed object pick', () => {
    const d = doc([vector('a', [rect('a1'), rect('a2'), ellipse])]);
    expect(multiLayerRectangles(d, 'objects', { layerId: 'a', ids: ['a1', 'a2'] }, [])).toEqual([
      { layerId: 'a', shapeId: 'a1' }, { layerId: 'a', shapeId: 'a2' },
    ]);
    expect(multiLayerRectangles(d, 'objects', { layerId: 'a', ids: ['a1', 'oval'] }, [])).toEqual([]);
  });

  it('applies one radius patch to the explicit targets and preserves other shapes/layers', () => {
    const d = doc([vector('a', [rect('a1', 4), ellipse]), vector('b', [rect('b1', 9)])]);
    const targets = multiLayerRectangles(d, 'layers', null, ['a', 'b']);
    expect(mixedRectangleRadii(d, targets)).toBe(true);
    const next = patchMultiLayerRectangles(d, targets, { rx: 12, ry: 6 });
    expect(next.layers[0].type === 'vector' && next.layers[0].shapes.map((s) => [s.id, s.rx, s.ry])).toEqual([
      ['a1', 12, 6], ['oval', 0, undefined],
    ]);
    expect(next.layers[1].type === 'vector' && next.layers[1].shapes[0]).toMatchObject({ id: 'b1', rx: 12, ry: 6 });
  });
});
