import { describe, expect, it } from 'vitest';
import type { DesignDoc, ShapeSpec, VectorLayer } from '../src/engine/types';
import { convertMultiRectanglesToPaths, mixedRectangleRadii, multiLayerRectangles, patchMultiLayerRectangles } from '../src/engine/design/multiRectEdit';

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

  it('converts only explicit rectangles to paths while preserving their rounded outline and unrelated shapes', () => {
    const first = { ...rect('a1', 12), ry: 6, fill: '#e33', stroke: '#123', strokeWidth: 4, rot: [0, 1, -1, 0] as [number, number, number, number] } as ShapeSpec;
    const second = rect('a2', 4) as ShapeSpec;
    const other = doc([vector('a', [first, ellipse, second]), vector('b', [rect('outside')])]);
    const targets = multiLayerRectangles(other, 'objects', { layerId: 'a', ids: ['a1', 'a2'] }, []);
    const next = convertMultiRectanglesToPaths(other, targets);
    const shapes = next.layers[0].type === 'vector' ? next.layers[0].shapes : [];
    expect(shapes[0]).toMatchObject({ id: 'a1', type: 'path', x: 0, y: 0, w: 80, h: 40, fill: '#e33', stroke: '#123', strokeWidth: 4, rx: undefined, ry: undefined, radius: 0, rot: first.rot });
    expect(shapes[0].d).toContain('M 12 0 L 68 0');
    expect(shapes[0].d).toContain('80 6 L 80 34');
    expect(shapes[0].d).toContain('0 34 L 0 6');
    expect(shapes[1]).toBe(ellipse);
    expect(shapes[2]).toMatchObject({ id: 'a2', type: 'path', rx: undefined, ry: undefined, radius: 0 });
    expect(shapes[2].d).toContain('M 4 0 L 76 0');
    expect(next.layers[1]).toBe(other.layers[1]);
  });
});
