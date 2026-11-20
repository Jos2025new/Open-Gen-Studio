import type { LayerStep, LayerType } from '../types';
import type { RawStep } from '../plan';
import { normalizeShapes, normalizeStrokes, normalizeTextStyle } from '../plan';
import { num } from './shared';
import type { StepEnv } from './env';

export async function normalizeLayer(s: RawStep, env: StepEnv): Promise<void> {
  const { ctx, errors, steps, expectImage } = env;
  const where = `Step ${s.id}`;
  const title = (s.title ?? '').trim() || s.id!;
  if (ctx.workspace !== 'designer') {
    errors.push(`${where}: layer steps are only valid in the Designer workspace.`);
    return;
  }
  const layerType = s.layer_type as LayerType;
  if (layerType !== 'raster' && layerType !== 'vector' && layerType !== 'text') {
    errors.push(`${where}: layer_type must be raster, vector or text.`);
    return;
  }
  const drawing = Boolean(s.strokes?.length);
  const target = s.target?.trim() || (layerType === 'raster' && !drawing ? 'base' : 'new');
  const strokes = drawing && layerType !== 'text' ? normalizeStrokes(s.strokes, errors, where) : undefined;
  if (drawing && layerType === 'text') errors.push(`${where}: text layers cannot take strokes; use a vector or raster layer.`);
  if (layerType === 'raster' && drawing) {
    // Painted strokes always go on a new layer: the user's own raster layers are never painted over.
    if (s.source) errors.push(`${where}: a raster layer takes either "source" or "strokes", not both.`);
    if (target !== 'new') errors.push(`${where}: painted strokes go on a new raster layer (target "new").`);
  } else if (layerType === 'raster') {
    if (!s.source) errors.push(`${where}: raster layers need "source" (an image step, asset:<id> or layer:<id>) or "strokes".`);
    else expectImage(s.source, where);
    if (target !== 'base' && target !== 'new') {
      const l = ctx.layer(target);
      if (!l) errors.push(`${where}: target layer "${target}" does not exist.`);
      else if (l.type !== 'raster') errors.push(`${where}: target layer "${target}" is ${l.type}; images can only be placed on raster layers.`);
    }
  } else {
    if (s.source) errors.push(`${where}: ${layerType} layers cannot take an image source; use a raster layer.`);
    if (target !== 'new') {
      const l = ctx.layer(target);
      if (!l) errors.push(`${where}: target layer "${target}" does not exist.`);
      else if (l.type !== layerType) errors.push(`${where}: target layer "${target}" is ${l.type}, not ${layerType}.`);
    }
    if (layerType === 'text' && !s.text?.trim()) errors.push(`${where}: text layers need "text".`);
    if (layerType === 'vector' && !s.shapes?.length && !drawing) errors.push(`${where}: vector layers need "shapes" or "strokes".`);
  }
  const step: LayerStep = {
    id: s.id!,
    kind: 'layer',
    title,
    layerType,
    source: layerType === 'raster' ? s.source : undefined,
    target,
    text: layerType === 'text' ? s.text?.trim() : undefined,
    style: layerType === 'text' ? normalizeTextStyle(s.style) : undefined,
    box: s.box ? { x: num(s.box.x, 0), y: num(s.box.y, 0), width: num(s.box.width, 0) } : undefined,
    shapes: layerType === 'vector' ? normalizeShapes(s.shapes, errors, where) : undefined,
    strokes,
  };
  steps.push(step);
}
