import type { DesignDoc, ShapeSpec } from '../types';
import type { ObjectPick } from './objectSelection';
import { shapeToPath } from './affine';
import { cornerRadii } from './shapeLook';

export type RectangleTarget = { layerId: string; shapeId: string };

export function mixedRectangleRadii(doc: DesignDoc, targets: RectangleTarget[]): boolean {
  const values = targets.flatMap((target) => {
    const layer = doc.layers.find((item) => item.id === target.layerId);
    const shape = layer?.type === 'vector' ? layer.shapes.find((item) => item.id === target.shapeId && item.type === 'rect') : undefined;
    return shape ? [cornerRadii(shape)] : [];
  });
  return values.some((value) => Math.abs(value.rx - values[0].rx) > 0.05 || Math.abs(value.ry - values[0].ry) > 0.05);
}

/** The shared corner editor only targets a complete Object pick or rectangles in explicitly picked Layers. */
export function multiLayerRectangles(doc: DesignDoc, mode: 'objects' | 'layers', objectPick: ObjectPick | null, layerIds: string[]): RectangleTarget[] {
  if (mode === 'objects') {
    if (!objectPick || objectPick.ids.length < 2) return [];
    const layer = doc.layers.find((item) => item.id === objectPick.layerId);
    if (layer?.type !== 'vector' || !layer.visible || layer.locked) return [];
    const selected = objectPick.ids.map((id) => layer.shapes.find((shape) => shape.id === id));
    if (selected.some((shape) => shape?.type !== 'rect')) return [];
    return selected.map((shape) => ({ layerId: layer.id, shapeId: shape!.id }));
  }
  if (layerIds.length < 2) return [];
  return doc.layers.filter((layer) => layerIds.includes(layer.id) && layer.type === 'vector' && layer.visible && !layer.locked)
    .flatMap((layer) => layer.type === 'vector' ? layer.shapes.filter((shape) => shape.type === 'rect').map((shape) => ({ layerId: layer.id, shapeId: shape.id })) : []);
}

/** Apply only to still-editable rectangle targets; shape sizes and all non-targets stay intact. */
export function patchMultiLayerRectangles(doc: DesignDoc, targets: RectangleTarget[], patch: Partial<Pick<ShapeSpec, 'rx' | 'ry' | 'radius'>>): DesignDoc {
  const byLayer = new Map<string, Set<string>>();
  for (const target of targets) {
    const ids = byLayer.get(target.layerId) ?? new Set<string>();
    ids.add(target.shapeId);
    byLayer.set(target.layerId, ids);
  }
  return { ...doc, updatedAt: Date.now(), layers: doc.layers.map((layer) => {
    const ids = byLayer.get(layer.id);
    if (!ids || layer.type !== 'vector' || !layer.visible || layer.locked) return layer;
    return { ...layer, shapes: layer.shapes.map((shape) => ids.has(shape.id) && shape.type === 'rect' ? { ...shape, ...patch } : shape) };
  }) };
}

/** Convert only the explicit, still-editable rectangle targets; rounded outlines and IDs are preserved. */
export function convertMultiRectanglesToPaths(doc: DesignDoc, targets: RectangleTarget[]): DesignDoc {
  const byLayer = new Map<string, Set<string>>();
  for (const target of targets) {
    const ids = byLayer.get(target.layerId) ?? new Set<string>();
    ids.add(target.shapeId);
    byLayer.set(target.layerId, ids);
  }
  return { ...doc, updatedAt: Date.now(), layers: doc.layers.map((layer) => {
    const ids = byLayer.get(layer.id);
    if (!ids || layer.type !== 'vector' || !layer.visible || layer.locked) return layer;
    return { ...layer, shapes: layer.shapes.map((shape) => ids.has(shape.id) && shape.type === 'rect' ? shapeToPath(shape) : shape) };
  }) };
}
