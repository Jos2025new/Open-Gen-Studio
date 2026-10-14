import type { DesignDoc, VectorShape } from '../types';
import { moveSelectedNodes, pageSegs, withSegs } from './pathNodes';
import { toLocal, toPage } from './shapeTransform';

export interface MultiPathTarget { layerId: string; shapeId: string; shape: VectorShape }
export interface PathNodeSelection { layerId: string; shapeId: string; nodes: number[] }

/** `pageSegs` applies a path's box/scale; a retained rotation matrix still needs to be applied per point. */
export function editablePageSegs(shape: VectorShape) {
  return pageSegs(shape).map((seg) => ({ ...seg, p: seg.p.map(([x, y]) => toPage(shape, x, y) as [number, number]) }));
}

/** Paths in the explicit Object or Layer selection. Primitives and non-path objects are never converted. */
export function multiPathTargets(doc: DesignDoc, mode: 'objects' | 'layers', objectPick: { layerId: string; ids: string[] } | null, layerIds: string[]): MultiPathTarget[] {
  const targets: MultiPathTarget[] = [];
  if (mode === 'objects') {
    const layer = doc.layers.find((item) => item.id === objectPick?.layerId);
    if (layer?.type !== 'vector' || !layer.visible || layer.locked || !objectPick) return targets;
    for (const id of objectPick.ids) {
      const shape = layer.shapes.find((item) => item.id === id);
      if (shape?.type === 'path') targets.push({ layerId: layer.id, shapeId: shape.id, shape });
    }
    return targets.length === objectPick.ids.length ? targets : [];
  }
  for (const id of layerIds) {
    const layer = doc.layers.find((item) => item.id === id);
    if (layer?.type !== 'vector' || !layer.visible || layer.locked) continue;
    for (const shape of layer.shapes) if (shape.type === 'path') targets.push({ layerId: layer.id, shapeId: shape.id, shape });
  }
  return targets;
}

/** Move selected nodes in page space; each path's transform is resolved independently. */
export function movePathNodeSelections(items: Array<{ shape: VectorShape; nodes: number[] }>, dx: number, dy: number): VectorShape[] {
  return items.map(({ shape, nodes }) => {
    if (!nodes.length) return shape;
    const origin = toLocal(shape, 0, 0), shifted = toLocal(shape, dx, dy);
    const localDelta = { x: shifted[0] - origin[0], y: shifted[1] - origin[1] };
    return withSegs(shape, moveSelectedNodes(pageSegs(shape), nodes, localDelta.x, localDelta.y));
  });
}
