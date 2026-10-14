import { describe, expect, it } from 'vitest';
import type { DesignDoc, VectorLayer, VectorShape } from '../src/engine/types';
import { multiPathTargets, movePathNodeSelections } from '../src/engine/design/multiPathEdit';
import { nodeSegs } from '../src/engine/design/pathNodes';
import { editablePageSegs } from '../src/engine/design/multiPathEdit';
import { shapeToPath, transformShape } from '../src/engine/design/affine';
import { rotateAbout } from '../src/engine/design/matrix';

const path = (id: string, x = 0, rot?: [number, number, number, number]): VectorShape => ({
  id, type: 'path', d: 'M 0 0 L 20 0 L 20 20 L 0 20 Z', box0: { x: 0, y: 0, w: 20, h: 20 },
  x, y: 0, w: 20, h: 20, fill: '#000', stroke: 'none', strokeWidth: 0, ...(rot ? { rot } : {}),
} as VectorShape);
const layer = (id: string, shapes: VectorShape[], flags: Partial<VectorLayer> = {}): VectorLayer => ({
  id, type: 'vector', name: id, visible: true, locked: false, opacity: 1, blend: 'normal', shapes, ...flags,
} as VectorLayer);
const doc = (layers: VectorLayer[]) => ({ id: 'd', name: 'd', width: 400, height: 300, activeLayerId: 'a', layers } as DesignDoc);

describe('multi-path node editing', () => {
  it('targets only explicitly selected paths in Object mode and visible, unlocked vector layers in Layer mode', () => {
    const d = doc([
      layer('a', [path('p1'), path('r', 40)]),
      layer('b', [path('p2')]),
      layer('hidden', [path('p3')], { visible: false }),
      layer('locked', [path('p4')], { locked: true }),
    ]);
    expect(multiPathTargets(d, 'objects', { layerId: 'a', ids: ['p1', 'r'] }, []).map(({ layerId, shapeId }) => ({ layerId, shapeId }))).toEqual([
      { layerId: 'a', shapeId: 'p1' }, { layerId: 'a', shapeId: 'r' },
    ]);
    expect(multiPathTargets(d, 'layers', null, ['a', 'b', 'hidden', 'locked']).map(({ layerId, shapeId }) => ({ layerId, shapeId }))).toEqual([
      { layerId: 'a', shapeId: 'p1' }, { layerId: 'a', shapeId: 'r' }, { layerId: 'b', shapeId: 'p2' },
    ]);
  });

  it('moves selected nodes by one page-space delta across differently transformed paths and leaves other nodes unchanged', () => {
    const a = path('a', 0);
    const turned = transformShape({ ...path('b', 100), type: 'rect', d: undefined } as unknown as VectorShape, rotateAbout(Math.PI / 2, 110, 10));
    const b = shapeToPath(turned);
    const moved = movePathNodeSelections([{ shape: a, nodes: [1] }, { shape: b, nodes: [1] }], 7, -3);
    expect(moved).toHaveLength(2);
    // Node 1 in each path has the same page-space delta despite the second path's rotation.
    for (let i = 0; i < 2; i++) {
      const before = (i ? b : a), after = moved[i];
      const nodeAt = (shape: VectorShape, node: number) => {
        const segs = editablePageSegs(shape), seg = nodeSegs(segs).seg[node];
        return segs[seg].p[segs[seg].p.length - 1];
      };
      const oldPicked = nodeAt(before, 1), newPicked = nodeAt(after, 1);
      expect(Math.abs(newPicked[0] - oldPicked[0] - 7)).toBeLessThan(0.02);
      expect(Math.abs(newPicked[1] - oldPicked[1] + 3)).toBeLessThan(0.02);
      expect(nodeAt(after, 2)).toEqual(nodeAt(before, 2));
    }
    expect(movePathNodeSelections([{ shape: b, nodes: [] }], 7, -3)[0]).toBe(b);
  });
});
