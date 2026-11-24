import { z } from 'zod';
import { useStore } from '../../store/store';
import { LAYER_DOC } from '../agent/layerDoc';
import { normalizeShapes } from '../planSteps/layer';
import type { BlendMode, Layer } from '../types';
import * as A from './actions';
import { docCommand, docOf, hasTarget, layerOf, layerRef } from './commandKit';
import { getBuffer } from './raster';
import { BLEND_MODES } from './render';

/* The Designer's layers as commands (ADR 0030). Each wraps the action the interface already calls. */

const one = z.object({ layer: layerRef }).strict();
const name = z.string().min(1).max(80);
const asset = z.string().min(1).max(80);
const textStyle = z
  .object({ fontFamily: z.string(), fontSize: z.number().positive(), fontWeight: z.number(), color: z.string(), align: z.enum(['left', 'center', 'right']), lineHeight: z.number().positive(), letterSpacing: z.number(), underline: z.boolean(), strike: z.boolean(), textCase: z.enum(['upper', 'lower', 'title']) })
  .partial()
  .strict();

/** An action answers null when it did nothing and told the person with a notice; a command must say it to its caller. */
function made(layer: string | null | undefined, why: string): { layer: string } {
  if (!layer) throw new Error(why);
  return { layer };
}

function imageAsset(id: string | undefined): true | string {
  if (!id) return true;
  const found = useStore.getState().assets[id];
  if (!found) return `No asset "${id}".`;
  return found.kind === 'image' ? true : 'Only images can be placed on layers.';
}

const withImage = (ctx: Parameters<typeof hasTarget>[0], args?: { layer?: string; asset?: string }) => {
  const target = hasTarget(ctx, args);
  return target === true ? imageAsset(args?.asset) : target;
};

export const commands = [
  docCommand({
    id: 'designer.layer.add',
    title: 'New layer',
    description: 'An empty layer above the active one; it becomes the active layer. Returns {layer}.',
    args: z.object({ type: z.enum(['raster', 'vector', 'text']) }).strict(),
    effect: 'write',
    debt: 'No position argument: it goes above the document\'s active layer; a text layer takes the text tool\'s style (ui.text).',
    run: (on, args) => made(A.addEmptyLayer(on.session, on.doc, args.type), 'The layer could not be added.'),
  }),
  docCommand({
    id: 'designer.layer.add_text',
    title: 'Add text',
    description: 'A text layer on top. x, y and width (wrap width; 0 = no wrap) in document px. Returns {layer}.',
    args: z.object({ text: z.string().min(1).max(4000), x: z.number(), y: z.number(), width: z.number().min(0), style: textStyle.optional(), name: name.optional() }).strict(),
    effect: 'write',
    run: (on, args) => made(A.addTextLayer(on.session, on.doc, args.text, { x: args.x, y: args.y, width: args.width }, args.style ?? {}, args.name), 'The text could not be added.'),
  }),
  docCommand({
    id: 'designer.layer.add_shapes',
    title: 'Add shapes',
    description: `A vector layer on top. shapes: ${LAYER_DOC.shapes} Returns {layer}.`,
    args: z.object({ shapes: z.array(z.record(z.string(), z.unknown())).min(1).max(40), name: name.optional() }).strict(),
    effect: 'write',
    run: (on, args) => {
      const errors: string[] = [];
      const shapes = normalizeShapes(args.shapes, errors, 'shapes');
      if (errors.length || !shapes.length) throw new Error(errors.join(' ') || 'No valid shape.');
      return made(A.addVectorLayer(on.session, on.doc, shapes, args.name), 'The shapes could not be added.');
    },
  }),
  docCommand({
    id: 'designer.layer.place_asset',
    title: 'Place image',
    description: 'An image of the gallery as pixels. target: "base" (layer 1), "new" (a layer above the active one), "replace" (the active layer) or a raster layer id. Returns {layer}.',
    args: z.object({ asset, target: z.string().min(1).max(80), name: name.optional() }).strict(),
    effect: 'write',
    debt: '"new" and "replace" depend on the document\'s active layer.',
    available: (ctx, args) => {
      const target = hasTarget(ctx, { layer: args?.target && !['base', 'new', 'replace'].includes(args.target) ? args.target : undefined });
      return target === true ? imageAsset(args?.asset) : target;
    },
    run: async (on, args) => made(await A.placeAsset(on.session, on.doc, args.asset, args.target, args.name), 'The image could not be placed there: the layer is locked or does not hold pixels.'),
  }),
  docCommand({
    id: 'designer.layer.select',
    title: 'Make layer active',
    description: 'The active layer of the document: where new layers go above. null for none.',
    args: z.object({ layer: layerRef.nullable() }).strict(),
    effect: 'write',
    undo: false,
    run: (on, args) => A.setActiveLayer(on.session, on.doc, args.layer),
  }),
  docCommand({
    id: 'designer.layer.set',
    title: 'Change layer',
    description: 'Name, visibility, lock, opacity (0..1), blend, position (x, y for raster/text), or text and text style.',
    args: z
      .object({ layer: layerRef, name: name.optional(), visible: z.boolean().optional(), locked: z.boolean().optional(), opacity: z.number().min(0).max(1).optional(), blend: z.enum(BLEND_MODES as [BlendMode, ...BlendMode[]]).optional(), text: z.string().max(4000).optional(), x: z.number().optional(), y: z.number().optional(), style: textStyle.optional() })
      .strict(),
    effect: 'write',
    run: (on, { layer, style, ...patch }) => {
      const target = layerOf(on, layer);
      if (target.locked && patch.locked !== false && (patch.x !== undefined || patch.y !== undefined || style !== undefined || patch.text !== undefined)) {
        throw new Error(`"${target.name}" is locked. Unlock it first.`);
      }
      if ((patch.text !== undefined || style !== undefined) && target.type !== 'text') throw new Error('Only a text layer has text or text style.');
      if ((patch.x !== undefined || patch.y !== undefined) && target.type !== 'raster' && target.type !== 'text') throw new Error('Only raster and text layers have x/y position.');
      const merged = { ...patch, ...(style ?? {}) };
      if (!Object.values(merged).some((value) => value !== undefined)) throw new Error('Nothing to change: give at least one field.');
      A.patchLayer(on.session, on.doc, layer, merged as Partial<Layer>);
    },
  }),
  docCommand({
    id: 'designer.layer.delete',
    title: 'Delete layers',
    description: 'Deletes these layers (undo brings them back); locked ones stay. Returns {kept_locked}.',
    args: z.object({ layers: z.array(layerRef).min(1).max(40) }).strict(),
    effect: 'write',
    run: (on, args) => ({ kept_locked: A.deleteLayers(on.session, on.doc, args.layers) }),
  }),
  docCommand({
    id: 'designer.layer.flatten',
    title: 'Flatten layers',
    description: 'These layers, as they show, become one raster layer in the place of the lowest. Returns {layer}.',
    args: z.object({ layers: z.array(layerRef).min(1).max(40), name: name.optional() }).strict(),
    effect: 'write',
    run: async (on, args) => made(await A.flattenLayers(on.session, on.doc, args.layers, args.name), 'Unlock the layers first.'),
  }),
  docCommand({
    id: 'designer.layer.merge_down',
    title: 'Merge down',
    description: 'Merges the layer into the one under it. Returns {layer}.',
    args: one,
    effect: 'write',
    run: async (on, args) => made(await A.mergeDown(on.session, on.doc, args.layer), 'There is no layer under it, or one of the two is locked.'),
  }),
  docCommand({
    id: 'designer.layer.rasterize',
    title: 'Rasterize layer',
    description: 'Text or shapes turned into pixels, as they show. Returns {layer}.',
    args: one,
    effect: 'write',
    run: async (on, args) => made(await A.rasterizeLayer(on.session, on.doc, args.layer), 'Unlock the layer first.'),
  }),
  docCommand({
    id: 'designer.layer.duplicate',
    title: 'Duplicate layer',
    description: 'A copy right above the layer; it becomes the active layer. Returns {layer}.',
    args: one,
    effect: 'write',
    available: (ctx, args) => {
      const target = hasTarget(ctx, args);
      if (target !== true || !args?.layer) return target;
      const layer = layerOf(ctx.on, args.layer);
      return layer.type === 'raster' && !getBuffer(layer.id) ? 'The pixels of this document are not loaded: run designer.doc.select on it first.' : true;
    },
    run: (on, args) => {
      A.duplicateLayer(on.session, on.doc, args.layer);
      return made(docOf(on).activeLayerId, 'The layer could not be duplicated.');
    },
  }),
  docCommand({
    id: 'designer.layer.move',
    title: 'Move layer up or down',
    description: 'One place up (1) or down (-1) in the stack.',
    args: z.object({ layer: layerRef, dir: z.union([z.literal(1), z.literal(-1)]) }).strict(),
    effect: 'write',
    run: (on, args) => A.moveLayer(on.session, on.doc, args.layer, args.dir),
  }),
  docCommand({
    id: 'designer.layer.reorder',
    title: 'Move layer to a place',
    description: 'To this place in the stack (0 = bottom).',
    args: z.object({ layer: layerRef, to: z.number().int().min(0) }).strict(),
    effect: 'write',
    run: (on, args) => A.reorderLayer(on.session, on.doc, args.layer, args.to),
  }),
  docCommand({
    id: 'designer.layer.rebase_paint',
    title: 'Refit painted layer to the page',
    description: 'After moving or scaling a painted layer: redraws it on a page-sized buffer so later strokes are not clipped.',
    args: one,
    effect: 'write',
    undo: false,
    run: (on, args) => A.rebasePaintLayer(on.session, on.doc, args.layer),
  }),
  docCommand({
    id: 'designer.layer.ensure_paint',
    title: 'Layer to paint on',
    description: 'The raster layer a brush stroke should go to: the active one if it accepts strokes, else a new one. Returns {layer}.',
    args: z.object({}).strict(),
    effect: 'write',
    undo: false,
    debt: 'Depends on the document\'s active layer and records no undo by itself (the stroke that follows does).',
    run: (on) => made(A.ensurePaintLayer(on.session, on.doc)?.id, 'There is no layer to paint on.'),
  }),
  docCommand({
    id: 'designer.layer.to_asset',
    title: 'Layer as image',
    description: 'The pixels of a raster layer as a new image in the gallery. Returns {asset}.',
    args: one,
    effect: 'write',
    undo: false,
    run: async (on, args) => ({ asset: (await A.layerToAsset(on.session, on.doc, args.layer)).id }),
  }),
  docCommand({
    id: 'designer.layer.replace_pixels',
    title: 'Replace layer pixels',
    description: 'A raster layer takes the pixels of this image and keeps its place and width.',
    args: z.object({ layer: layerRef, asset }).strict(),
    effect: 'write',
    available: withImage,
    run: async (on, args) => {
      if (layerOf(on, args.layer).type !== 'raster') throw new Error('Only raster layers hold pixels.');
      await A.replaceLayerPixels(on.session, on.doc, args.layer, args.asset);
    },
  }),
  docCommand({
    id: 'designer.layer.place_above',
    title: 'Place image above layer',
    description: 'This image as a new raster layer right above a raster layer, in the same place. Returns {layer}.',
    args: z.object({ layer: layerRef, asset, name }).strict(),
    effect: 'write',
    available: withImage,
    run: async (on, args) => made(await A.placeAboveLayer(on.session, on.doc, args.layer, args.asset, args.name), 'Only a raster layer can take an image above it this way.'),
  }),
];
