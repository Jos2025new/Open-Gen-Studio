import { describe, expect, it } from 'vitest';
import type { DesignDoc, VectorLayer, VectorShape } from '../src/engine/types';
import { pathNodeTargets, PathNodeSnapSession } from '../src/engine/design/snapNodes';

const path = (id: string, d: string): VectorShape => ({
  id, type: 'path', d, x: 0, y: 0, w: 300, h: 300, box0: { x: 0, y: 0, w: 300, h: 300 },
  fill: '#fff', stroke: null, strokeWidth: 0,
} as VectorShape);
const layer = (id: string, shapes: VectorShape[], visible = true): VectorLayer => ({
  id, name: id, type: 'vector', visible, locked: false, opacity: 1, blend: 'normal', shapes,
});

describe('path-node snapping', () => {
  it('collects nodes from visible paths except the path being edited', () => {
    const doc = { layers: [
      layer('visible', [path('moving', 'M 10 10 L 20 10'), path('target', 'M 40 50 L 70 80')]),
      layer('hidden', [path('hidden-target', 'M 90 90 L 100 100')], false),
      { id: 'text', type: 'text', visible: true },
    ] } as unknown as Pick<DesignDoc, 'layers'>;
    expect(pathNodeTargets(doc, 'moving', [10, 10])).toEqual([[40, 50], [70, 80]]);
  });

  it('matches a two-dimensional node after the 150 ms idle delay within screen tolerance', () => {
    const session = new PathNodeSnapSession([[50, 50]], 2, { x: 0, y: 0, t: 0 });
    expect(session.step([48, 48], { x: 100, y: 100 }, 10)).toBeNull(); // fast: defer the snap
    expect(session.step([48, 48], { x: 100, y: 100 }, 160)).toEqual([50, 50]); // 2 px at zoom 2
  });

  it('does not snap beyond the 10-screen-pixel tolerance', () => {
    const session = new PathNodeSnapSession([[50, 50]], 2, { x: 0, y: 0, t: 0 });
    expect(session.step([44, 50], { x: 1, y: 0 }, 1)).toBeNull();
  });
});
