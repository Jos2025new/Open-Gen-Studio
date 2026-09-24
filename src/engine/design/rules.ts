import type { Layer, LayerType } from '../types';

/* What each layer type accepts. The whole app routes placement through these rules. */

export type PlaceableContent = 'image' | 'video' | 'text' | 'shapes';

const ACCEPTS: Record<LayerType, PlaceableContent> = {
  raster: 'image',
  text: 'text',
  vector: 'shapes',
};

export function layerAccepts(layerType: LayerType, content: PlaceableContent): boolean {
  return ACCEPTS[layerType] === content;
}

export function placementError(layer: Pick<Layer, 'type' | 'name'>, content: PlaceableContent): string | null {
  if (layerAccepts(layer.type, content)) return null;
  if (content === 'video') return 'Designer layers cannot hold video. Extract a frame to place it as an image.';
  const need = content === 'image' ? 'raster' : content === 'text' ? 'text' : 'vector';
  return `"${layer.name}" is a ${layer.type} layer; ${content === 'shapes' ? 'shapes' : content === 'image' ? 'images' : 'text'} need a ${need} layer.`;
}

export type DesignTool = 'move' | 'hand' | 'brush' | 'eraser' | 'rect' | 'ellipse' | 'line' | 'text';

export const TOOL_LAYER: Partial<Record<DesignTool, LayerType>> = {
  brush: 'raster',
  eraser: 'raster',
  rect: 'vector',
  ellipse: 'vector',
  line: 'vector',
  text: 'text',
};

/**
 * Whether a tool can act on the active layer. Shape and text tools create a
 * layer of their type when needed; paint tools only work on raster layers.
 */
export function toolBlockReason(tool: DesignTool, active: Layer | null): string | null {
  if (tool === 'hand') return null;
  if (tool === 'move') {
    if (!active) return 'Select a layer to move.';
    if (active.locked) return `"${active.name}" is locked.`;
    return null;
  }
  const needs = TOOL_LAYER[tool];
  if (tool === 'brush' || tool === 'eraser') {
    if (!active) return 'Select or create a raster layer to paint.';
    if (active.type !== 'raster') return `"${active.name}" is a ${active.type} layer. Painting only works on raster layers.`;
    if (active.locked) return `"${active.name}" is locked.`;
    return null;
  }
  if (needs && active && active.type === needs && active.locked) return `"${active.name}" is locked.`;
  return null;
}
