import { z } from 'zod';
import { BUILTIN_EXPORTS, EXPORT_FORMATS } from '../design/exportSettings';
import type { ToolSpec } from '../providers/llm';
import { FX_DEFS, FX_KINDS } from '../fx/defs';
import { COMMAND_TOOLS } from './commandTools';

/* Designer tools: look at the page, and FX layers through the same commands as the layers panel (ADR 0011). */

const kindsLine = FX_KINDS.map((k) => {
  const d = FX_DEFS[k];
  return `${k} (${d.group}: ${d.params.map((p) => (p.type === 'color' ? `${p.key} #rrggbb` : `${p.key} ${p.min}..${p.max}, default ${p.default}`)).join('; ')})`;
}).join(', ');

export const DESIGNER_TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'export_design',
      description: 'Designer only, free and local. Use only when the user asks to download an export. Exports the requested area of the active document and requests a browser download. Defaults to the canvas. Choose a format or a built-in preset; Logo / brand produces one ZIP.',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: EXPORT_FORMATS },
          preset: { type: 'string', enum: BUILTIN_EXPORTS.map((preset) => preset.id) },
          area: { type: 'string', enum: ['canvas', 'content', 'objects', 'selection', 'layer'], description: 'Content trims the canvas to the drawing; objects are the currently picked objects; selection is the current pixel selection.' },
          layer_id: { type: 'string', description: 'For a layer export, use its id or omit for the active layer.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'view_canvas',
      description:
        'Designer only: see the page again, or one layer alone (layer_id), as a reduced image with the scale back to document px. The page already comes with each new request; call this only for a single layer or after changes.',
      parameters: { type: 'object', properties: { layer_id: { type: 'string', description: 'A layer id from the context; omit for the whole page.' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'designer_fx',
      description:
        `Designer only: add or change non-destructive filter and effect layers (FX). Commands run in order as the user's own panel actions; all or nothing, one undo step, free. A filter layer holds filters, an effect layer effects. scope "layer" acts only on the nearest normal layer under it (a filter or effect "on" that layer: add with above = that layer id, scope "layer", simple true for one op); scope "below" acts on everything under it. Commands: add {group, scope, above?, ops?, name?, simple?}; set {layer, name?, scope?, opacity?, blend?, visible?, simple?}; add_op {layer, kind, params?, index?}; set_op {layer, op, params?, enabled?}; move_op {layer, op, to}; remove_op {layer, op}; delete {layer}. layer is an FX layer id from the context or "last" (added earlier in this list); op is an op id or "first". Ops are applied first to last. Kinds and params: ${kindsLine}.`,
      parameters: {
        type: 'object',
        properties: {
          commands: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                do: { type: 'string', enum: ['add', 'set', 'add_op', 'set_op', 'move_op', 'remove_op', 'delete'] },
                layer: { type: 'string' },
                group: { type: 'string', enum: ['filter', 'effect'] },
                scope: { type: 'string', enum: ['layer', 'below'] },
                above: { type: 'string', description: 'Layer id to place the new FX layer above; default the active layer.' },
                name: { type: 'string' },
                simple: { type: 'boolean' },
                ops: { type: 'array', maxItems: 12, items: { type: 'object', properties: { kind: { type: 'string', enum: FX_KINDS }, params: { type: 'object' }, enabled: { type: 'boolean' } }, required: ['kind'] } },
                kind: { type: 'string', enum: FX_KINDS },
                op: { type: 'string' },
                params: { type: 'object' },
                enabled: { type: 'boolean' },
                index: { type: 'integer' },
                to: { type: 'integer' },
                opacity: { type: 'number', minimum: 0, maximum: 1 },
                blend: { type: 'string' },
                visible: { type: 'boolean' },
              },
              required: ['do'],
            },
          },
        },
        required: ['commands'],
      },
    },
  },
  ...COMMAND_TOOLS,
];

const params = z.record(z.string(), z.union([z.number(), z.string()])).optional();
const layerRef = z.string().min(1).max(80);
const commandSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('add'), group: z.enum(['filter', 'effect']), scope: z.enum(['layer', 'below']).optional(), above: layerRef.optional(), name: z.string().max(80).optional(), simple: z.boolean().optional(), ops: z.array(z.object({ kind: z.string(), params, enabled: z.boolean().optional() })).max(12).optional() }),
  z.object({ do: z.literal('set'), layer: layerRef, name: z.string().max(80).optional(), scope: z.enum(['layer', 'below']).optional(), opacity: z.number().optional(), blend: z.string().optional(), visible: z.boolean().optional(), simple: z.boolean().optional() }),
  z.object({ do: z.literal('add_op'), layer: layerRef, kind: z.string(), params, index: z.number().int().optional() }),
  z.object({ do: z.literal('set_op'), layer: layerRef, op: z.string(), params, enabled: z.boolean().optional() }),
  z.object({ do: z.literal('move_op'), layer: layerRef, op: z.string(), to: z.number().int() }),
  z.object({ do: z.literal('remove_op'), layer: layerRef, op: z.string() }),
  z.object({ do: z.literal('delete'), layer: layerRef }),
]);
export const designerFxSchema = z.object({ commands: z.array(commandSchema).min(1).max(20) });

export const exportDesignSchema = z.object({
  format: z.enum(EXPORT_FORMATS).optional(),
  preset: z.enum(BUILTIN_EXPORTS.map((option) => option.id)).optional(),
  area: z.enum(['canvas', 'content', 'objects', 'selection', 'layer']).optional(),
  layer_id: z.string().min(1).max(80).optional(),
}).strict().refine(({ layer_id, area }) => !layer_id || area === 'layer', 'Use layer_id only for a layer export.')
  .refine(({ format, preset }) => !preset || !format, 'Choose one available preset or a format.');
